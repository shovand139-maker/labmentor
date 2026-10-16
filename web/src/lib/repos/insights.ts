import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/tenant";
import type { LabInsights, OpenQuestion, Policy, StepInsight } from "../types";

const POLICIES: Policy[] = [
  "answered",
  "hint_only",
  "solution_withheld",
  "not_in_guide",
];

/**
 * What instructors need to improve a lab: where learners get stuck and what the guide does not answer.
 * Runs as the instructor, so row-level security limits it to their organization.
 */
export async function labInsights(
  tx: Tx,
  slug: string,
  days: number,
): Promise<LabInsights | null> {
  const lab = await tx.execute<{ id: string; title: string }>(
    sql`select id, title from labs where slug = ${slug}`,
  );
  const found = lab.rows[0];
  if (!found) return null;
  const since = sql`now() - make_interval(days => ${days})`;

  // Each question paired with the answer that followed it in the same conversation.
  const pairs = sql`
    select q.id as question_id, q.content as question, q.current_step, q.created_at, c.user_id,
           a.id as answer_id, a.policy, a.needs_instructor, a.confidence, f.rating
    from messages q
    join conversations c on c.id = q.conversation_id
    left join lateral (
      select m.id, m.policy, m.needs_instructor, m.confidence
      from messages m
      where m.conversation_id = q.conversation_id and m.role = 'assistant' and m.created_at >= q.created_at
      order by m.created_at
      limit 1
    ) a on true
    left join feedback f on f.message_id = a.id
    where c.lab_id = ${found.id} and q.role = 'user' and q.created_at >= ${since}`;

  const [totals, policies, steps, open] = await Promise.all([
    tx.execute<{
      learners: number;
      questions: number;
      needs_instructor: number;
      up: number;
      down: number;
      confidence: number | null;
    }>(sql`
      select count(distinct user_id)::int as learners, count(*)::int as questions,
             count(*) filter (where needs_instructor)::int as needs_instructor,
             count(*) filter (where rating = 1)::int as up, count(*) filter (where rating = -1)::int as down,
             round(avg(confidence)::numeric, 2)::float as confidence
      from (${pairs}) p`),
    tx.execute<{ policy: Policy; n: number }>(sql`
      select policy, count(*)::int as n from (${pairs}) p where policy is not null group by policy`),
    tx.execute<{
      position: number;
      title: string;
      graded: boolean;
      questions: number;
      needs_instructor: number;
      down: number;
    }>(sql`
      select s.position, s.title, s.graded,
             count(p.question_id)::int as questions,
             count(p.question_id) filter (where p.needs_instructor)::int as needs_instructor,
             count(p.question_id) filter (where p.rating = -1)::int as down
      from lab_steps s
      left join (${pairs}) p on p.current_step = s.position
      where s.lab_id = ${found.id}
      group by s.position, s.title, s.graded
      order by s.position`),
    tx.execute<{
      question_id: string;
      learner: string;
      question: string;
      current_step: number | null;
      policy: Policy | null;
      rating: number | null;
      created_at: Date;
    }>(sql`
      select p.question_id, u.name as learner, p.question, p.current_step, p.policy, p.rating, p.created_at
      from (${pairs}) p
      join users u on u.id = p.user_id
      where p.needs_instructor or p.rating = -1
      order by p.created_at desc
      limit 20`),
  ]);

  const t = totals.rows[0]!;
  const byPolicy = Object.fromEntries(POLICIES.map((p) => [p, 0])) as Record<
    Policy,
    number
  >;
  for (const row of policies.rows) byPolicy[row.policy] = row.n;

  const stepRows: StepInsight[] = steps.rows.map((s) => ({
    position: s.position,
    title: s.title,
    graded: s.graded,
    questions: s.questions,
    needsInstructor: s.needs_instructor,
    thumbsDown: s.down,
  }));
  const openQuestions: OpenQuestion[] = open.rows.map((q) => ({
    messageId: q.question_id,
    learner: q.learner,
    question: q.question,
    step: q.current_step,
    policy: q.policy,
    reason:
      q.policy === "not_in_guide"
        ? "not_in_guide"
        : q.rating === -1
          ? "rated_unhelpful"
          : "low_confidence",
    askedAt: new Date(q.created_at).toISOString(),
  }));

  return {
    slug,
    title: found.title,
    days,
    learners: t.learners,
    questions: t.questions,
    byPolicy,
    needsInstructor: t.needs_instructor,
    thumbsUp: t.up,
    thumbsDown: t.down,
    averageConfidence: t.confidence,
    steps: stepRows,
    openQuestions,
  };
}
