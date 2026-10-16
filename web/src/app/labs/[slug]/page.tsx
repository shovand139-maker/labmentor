import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ChatPanel } from "@/components/ChatPanel";
import { SolutionsToggle, StepDone } from "@/components/Controls";
import { RichText } from "@/components/RichText";
import { labs } from "@/lib/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { pageSession } from "@/lib/page";
import { existingConversation, listMessages } from "@/lib/repos/conversations";
import { currentStep, labGuide } from "@/lib/repos/labs";
import { slugParam } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).slug.replace(/-/g, " ") };
}

export default async function LabPage({ params }: Props) {
  const slug = slugParam.safeParse((await params).slug);
  if (!slug.success) notFound();
  const { session, organization } = await pageSession();

  const data = await withTenant(session, async (tx) => {
    const guide = await labGuide(tx, slug.data, session.userId);
    if (!guide) return null;
    const [lab] = await tx
      .select({ id: labs.id })
      .from(labs)
      .where(eq(labs.slug, slug.data));
    const conversationId = lab
      ? await existingConversation(tx, session, lab.id)
      : null;
    return {
      guide,
      messages: conversationId
        ? await listMessages(tx, session, conversationId)
        : [],
    };
  });
  if (!data) notFound();
  const { guide, messages } = data;

  const current = currentStep(
    guide.guide.length,
    guide.guide.filter((s) => s.completed).map((s) => s.position),
  );
  const suggestions = [
    `I'm stuck on step ${current ?? 1}, can I get a hint?`,
    ...(guide.faq[0] ? [guide.faq[0].question] : []),
    `What does step ${current ?? 1} ask me to do?`,
  ];

  return (
    <>
      <AppHeader session={session} organization={organization} />
      <main className="lab">
        <div className="guide">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/labs">Labs</Link> <span aria-hidden="true">/</span>{" "}
            <span>{guide.title}</span>
          </nav>
          <header className="guide-head">
            <h1>{guide.title}</h1>
            <p>{guide.summary}</p>
            <p className="muted">
              {guide.durationMinutes} min · {guide.completed} of {guide.steps}{" "}
              steps done
            </p>
            {session.role === "instructor" && (
              <SolutionsToggle
                slug={guide.slug}
                allowed={guide.solutionsAllowed}
              />
            )}
          </header>

          <ol className="steps">
            {guide.guide.map((step) => (
              <li
                key={step.position}
                id={`guide-step-${step.position}`}
                className={`step${step.completed ? " step-complete" : ""}${step.position === current ? " step-current" : ""}`}
              >
                <div className="step-head">
                  <span className="step-number" aria-hidden="true">
                    {step.position}
                  </span>
                  <h2>
                    <span className="sr-only">Step {step.position}: </span>
                    {step.title}
                  </h2>
                  {step.graded && (
                    <span
                      className="badge badge-graded"
                      title="Checked automatically. LabMentor gives hints, not solutions."
                    >
                      Graded
                    </span>
                  )}
                  <StepDone
                    slug={guide.slug}
                    position={step.position}
                    completed={step.completed}
                  />
                </div>
                <div className="step-body">
                  <RichText text={step.body} />
                </div>
              </li>
            ))}
          </ol>

          {guide.faq.length > 0 && (
            <section className="faq" aria-labelledby="faq-title">
              <h2 id="faq-title">Troubleshooting</h2>
              {guide.faq.map((entry) => (
                <details
                  key={entry.position}
                  id={`guide-faq-${entry.position}`}
                >
                  <summary>{entry.question}</summary>
                  <RichText text={entry.answer} />
                </details>
              ))}
            </section>
          )}
        </div>
        <aside className="assistant">
          <ChatPanel
            slug={guide.slug}
            initial={messages}
            suggestions={suggestions}
          />
        </aside>
      </main>
    </>
  );
}
