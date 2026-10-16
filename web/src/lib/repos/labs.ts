import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import { labFaq, labs, labSteps, progress, type Hints } from "../db/schema";
import type { LabGuide, LabSummary } from "../types";

export type AssistantLab = {
  id: string;
  slug: string;
  title: string;
  solutionsAllowed: boolean;
  steps: {
    position: number;
    title: string;
    body: string;
    graded: boolean;
    hints: Hints;
    solution: string[];
  }[];
  faq: { question: string; answer: string }[];
};

export async function listLabs(tx: Tx, userId: string): Promise<LabSummary[]> {
  const rows = await tx
    .select({
      slug: labs.slug,
      title: labs.title,
      summary: labs.summary,
      durationMinutes: labs.durationMinutes,
      solutionsAllowed: labs.solutionsAllowed,
      steps: sql<number>`(select count(*)::int from lab_steps s where s.lab_id = "labs"."id")`,
      completed: sql<number>`(select count(*)::int from progress p where p.lab_id = "labs"."id" and p.user_id = ${userId})`,
    })
    .from(labs)
    .orderBy(asc(labs.title));
  return rows;
}

async function findLab(tx: Tx, slug: string) {
  const [lab] = await tx
    .select()
    .from(labs)
    .where(eq(labs.slug, slug))
    .limit(1);
  return lab;
}

export async function completedSteps(
  tx: Tx,
  labId: string,
  userId: string,
): Promise<number[]> {
  const rows = await tx
    .select({ position: progress.position })
    .from(progress)
    .where(and(eq(progress.labId, labId), eq(progress.userId, userId)))
    .orderBy(asc(progress.position));
  return rows.map((r) => r.position);
}

export async function labGuide(
  tx: Tx,
  slug: string,
  userId: string,
): Promise<LabGuide | null> {
  const lab = await findLab(tx, slug);
  if (!lab) return null;
  const [steps, faq, done] = await Promise.all([
    tx
      .select({
        position: labSteps.position,
        title: labSteps.title,
        body: labSteps.body,
        graded: labSteps.graded,
      })
      .from(labSteps)
      .where(eq(labSteps.labId, lab.id))
      .orderBy(asc(labSteps.position)),
    tx
      .select({
        position: labFaq.position,
        question: labFaq.question,
        answer: labFaq.answer,
      })
      .from(labFaq)
      .where(eq(labFaq.labId, lab.id))
      .orderBy(asc(labFaq.position)),
    completedSteps(tx, lab.id, userId),
  ]);
  const completed = new Set(done);
  return {
    slug: lab.slug,
    title: lab.title,
    summary: lab.summary,
    durationMinutes: lab.durationMinutes,
    solutionsAllowed: lab.solutionsAllowed,
    steps: steps.length,
    completed: completed.size,
    guide: steps.map((s) => ({ ...s, completed: completed.has(s.position) })),
    faq,
  };
}

/** Everything the assistant needs, including hints and solutions. Only ever sent server to server. */
export async function labForAssistant(
  tx: Tx,
  slug: string,
): Promise<AssistantLab | null> {
  const lab = await findLab(tx, slug);
  if (!lab) return null;
  const [steps, faq] = await Promise.all([
    tx
      .select()
      .from(labSteps)
      .where(eq(labSteps.labId, lab.id))
      .orderBy(asc(labSteps.position)),
    tx
      .select()
      .from(labFaq)
      .where(eq(labFaq.labId, lab.id))
      .orderBy(asc(labFaq.position)),
  ]);
  return {
    id: lab.id,
    slug: lab.slug,
    title: lab.title,
    solutionsAllowed: lab.solutionsAllowed,
    steps: steps.map(({ position, title, body, graded, hints, solution }) => ({
      position,
      title,
      body,
      graded,
      hints,
      solution,
    })),
    faq: faq.map(({ question, answer }) => ({ question, answer })),
  };
}

/** The first step not yet completed, or the last step when all are done. */
export function currentStep(total: number, completed: number[]): number | null {
  if (total === 0) return null;
  const done = new Set(completed);
  for (let position = 1; position <= total; position += 1) {
    if (!done.has(position)) return position;
  }
  return total;
}

export async function setStepCompleted(
  tx: Tx,
  session: { tenantId: string; userId: string },
  slug: string,
  position: number,
  completed: boolean,
): Promise<number[] | null> {
  const lab = await findLab(tx, slug);
  if (!lab) return null;
  const [step] = await tx
    .select({ position: labSteps.position })
    .from(labSteps)
    .where(and(eq(labSteps.labId, lab.id), eq(labSteps.position, position)));
  if (!step) return null;
  if (completed) {
    await tx
      .insert(progress)
      .values({
        tenantId: session.tenantId,
        userId: session.userId,
        labId: lab.id,
        position,
      })
      .onConflictDoNothing();
  } else {
    await tx
      .delete(progress)
      .where(
        and(
          eq(progress.labId, lab.id),
          eq(progress.userId, session.userId),
          eq(progress.position, position),
        ),
      );
  }
  return completedSteps(tx, lab.id, session.userId);
}

export async function setSolutionsAllowed(
  tx: Tx,
  slug: string,
  allowed: boolean,
): Promise<boolean> {
  const updated = await tx
    .update(labs)
    .set({ solutionsAllowed: allowed, updatedAt: sql`now()` })
    .where(eq(labs.slug, slug))
    .returning({ slug: labs.slug });
  return updated.length > 0;
}
