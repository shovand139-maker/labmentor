import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { withTenant } from "@/lib/db/tenant";
import { pageSession } from "@/lib/page";
import { labInsights } from "@/lib/repos/insights";
import { listLabs } from "@/lib/repos/labs";
import type { Policy } from "@/lib/types";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

const POLICY_LABELS: Record<Policy, string> = {
  answered: "Answered from the guide",
  hint_only: "Hint given",
  solution_withheld: "Solution withheld",
  not_in_guide: "Not in the guide",
};

const REASONS = {
  not_in_guide: "not in the guide",
  low_confidence: "low-confidence answer",
  rated_unhelpful: "rated not helpful",
} as const;

type Props = { searchParams: Promise<{ lab?: string; days?: string }> };

export default async function InsightsPage({ searchParams }: Props) {
  const { session, organization } = await pageSession();
  if (session.role !== "instructor") redirect("/labs");
  const query = await searchParams;
  const days = [7, 30, 90].includes(Number(query.days))
    ? Number(query.days)
    : 30;

  const { labs, insights } = await withTenant(session, async (tx) => {
    const all = await listLabs(tx, session.userId);
    const slug = all.some((l) => l.slug === query.lab)
      ? query.lab!
      : all[0]?.slug;
    return {
      labs: all,
      insights: slug ? await labInsights(tx, slug, days) : null,
    };
  });

  const busiest = Math.max(
    1,
    ...(insights?.steps.map((s) => s.questions) ?? [0]),
  );

  return (
    <>
      <AppHeader session={session} organization={organization} />
      <main className="page">
        <div className="page-head">
          <h1>Insights</h1>
          <p className="muted">
            Where learners get stuck, and what the guide does not answer yet.
          </p>
        </div>

        <div className="filters">
          <nav className="tabs" aria-label="Lab">
            {labs.map((l) => (
              <Link
                key={l.slug}
                href={`/insights?lab=${l.slug}&days=${days}`}
                aria-current={l.slug === insights?.slug ? "page" : undefined}
              >
                {l.title}
              </Link>
            ))}
          </nav>
          <nav className="tabs tabs-small" aria-label="Period">
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={`/insights?lab=${insights?.slug ?? ""}&days=${d}`}
                aria-current={d === days ? "page" : undefined}
              >
                {d} days
              </Link>
            ))}
          </nav>
        </div>

        {!insights ? (
          <p className="muted">No labs yet.</p>
        ) : (
          <>
            <dl className="kpis">
              <div>
                <dt>Questions</dt>
                <dd data-testid="kpi-questions">{insights.questions}</dd>
              </div>
              <div>
                <dt>Learners asking</dt>
                <dd>{insights.learners}</dd>
              </div>
              <div className={insights.needsInstructor ? "kpi-alert" : ""}>
                <dt>Need you</dt>
                <dd data-testid="kpi-flagged">{insights.needsInstructor}</dd>
              </div>
              <div>
                <dt>Rated helpful</dt>
                <dd>
                  {insights.thumbsUp}
                  <small>
                    {" "}
                    / {insights.thumbsUp + insights.thumbsDown} rated
                  </small>
                </dd>
              </div>
              <div>
                <dt>Average confidence</dt>
                <dd>
                  {insights.averageConfidence === null
                    ? "–"
                    : `${Math.round(insights.averageConfidence * 100)}%`}
                </dd>
              </div>
            </dl>

            <div className="insight-grid">
              <section className="card">
                <h2 className="card-title">Questions by step</h2>
                <table className="step-table">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Questions</th>
                      <th scope="col">Need you</th>
                      <th scope="col">Not helpful</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.steps.map((s) => (
                      <tr key={s.position}>
                        <th scope="row">
                          <span className="step-index">{s.position}</span>{" "}
                          {s.title}
                          {s.graded && (
                            <span className="badge badge-graded">Graded</span>
                          )}
                        </th>
                        <td>
                          <span
                            className="bar"
                            style={{
                              width: `${(s.questions / busiest) * 100}%`,
                            }}
                            aria-hidden="true"
                          />
                          {s.questions}
                        </td>
                        <td className={s.needsInstructor ? "warn" : ""}>
                          {s.needsInstructor}
                        </td>
                        <td className={s.thumbsDown ? "warn" : ""}>
                          {s.thumbsDown}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="card">
                <h2 className="card-title">How questions were answered</h2>
                <ul className="policy-list">
                  {(Object.keys(POLICY_LABELS) as Policy[]).map((p) => (
                    <li key={p}>
                      <span className={`dot dot-${p}`} aria-hidden="true" />
                      {POLICY_LABELS[p]}
                      <strong>{insights.byPolicy[p]}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="card">
              <h2 className="card-title">Questions that need you</h2>
              {insights.openQuestions.length === 0 ? (
                <p className="muted">
                  Nothing waiting. Every question in this period was answered
                  from the guide.
                </p>
              ) : (
                <ul className="open-questions" data-testid="open-questions">
                  {insights.openQuestions.map((q) => (
                    <li key={q.messageId}>
                      <p className="q">“{q.question}”</p>
                      <p className="muted">
                        {q.learner} · {q.step ? `step ${q.step}` : "no step"} ·{" "}
                        {REASONS[q.reason]} ·{" "}
                        <time dateTime={q.askedAt}>
                          {new Date(q.askedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
