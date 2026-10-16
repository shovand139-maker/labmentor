import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { withTenant } from "@/lib/db/tenant";
import { pageSession } from "@/lib/page";
import { listLabs } from "@/lib/repos/labs";

export const metadata: Metadata = { title: "Labs" };
export const dynamic = "force-dynamic";

export default async function LabsPage() {
  const { session, organization } = await pageSession();
  const labs = await withTenant(session, (tx) => listLabs(tx, session.userId));

  return (
    <>
      <AppHeader session={session} organization={organization} />
      <main className="page">
        <div className="page-head">
          <h1>
            {session.role === "instructor"
              ? "Labs in your organization"
              : "Your labs"}
          </h1>
          <p className="muted">
            {labs.length} lab{labs.length === 1 ? "" : "s"} · {organization}
          </p>
        </div>
        <ul className="lab-grid">
          {labs.map((lab) => {
            const share = lab.steps
              ? Math.round((lab.completed / lab.steps) * 100)
              : 0;
            return (
              <li key={lab.slug}>
                <Link href={`/labs/${lab.slug}`} className="card lab-card">
                  <h2>{lab.title}</h2>
                  <p>{lab.summary}</p>
                  <div className="lab-meta">
                    <span>{lab.durationMinutes} min</span>
                    <span>{lab.steps} steps</span>
                    {lab.solutionsAllowed && (
                      <span className="badge badge-hint">
                        Walkthroughs released
                      </span>
                    )}
                  </div>
                  <div
                    className="progress"
                    aria-label={`${lab.completed} of ${lab.steps} steps done`}
                  >
                    <span style={{ width: `${share}%` }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
