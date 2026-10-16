import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LabMentorError, type LabMentorApi } from "./api.js";

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,59}$/)
  .describe("The lab's slug, as returned by list_labs");
const days = z.number().int().min(1).max(365).default(30).describe("How many days back to look");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] });

/** Turn API failures into tool errors the model can read, instead of protocol errors. */
async function safely(work: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await work());
  } catch (error) {
    const message =
      error instanceof LabMentorError
        ? error.status === 403
          ? "This token belongs to a learner. Insights need an instructor token."
          : error.message
        : "LabMentor could not be reached.";
    return { ...text(message), isError: true };
  }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * Read-only tools for an instructor's AI client. Everything goes through the web API with the instructor's
 * token, so the same row-level security applies: one organization, and no hints or solutions.
 */
export function createServer(api: LabMentorApi): McpServer {
  const server = new McpServer({ name: "labmentor", version: "1.0.0" });

  server.registerTool(
    "list_labs",
    { title: "List labs", description: "The labs in the instructor's organization.", annotations: READ_ONLY },
    () =>
      safely(async () => {
        const labs = await api.labs();
        if (labs.length === 0) return "No labs yet.";
        return labs
          .map(
            (l) =>
              `- ${l.slug}: ${l.title} (${l.steps} steps, ${l.durationMinutes} min` +
              `${l.solutionsAllowed ? ", walkthroughs released" : ""})`,
          )
          .join("\n");
      }),
  );

  server.registerTool(
    "get_lab_guide",
    {
      title: "Read a lab guide",
      description: "The steps and troubleshooting notes of one lab, as learners see them.",
      inputSchema: { slug },
      annotations: READ_ONLY,
    },
    ({ slug }) =>
      safely(async () => {
        const lab = await api.guide(slug);
        const steps = lab.guide.map(
          (s) => `## Step ${s.position}: ${s.title}${s.graded ? " (graded)" : ""}\n\n${s.body}`,
        );
        const faq = lab.faq.map((f) => `- **${f.question}** ${f.answer.replace(/\s+/g, " ")}`);
        return [`# ${lab.title}`, lab.summary, ...steps, faq.length ? `## Troubleshooting\n\n${faq.join("\n")}` : ""]
          .filter(Boolean)
          .join("\n\n");
      }),
  );

  server.registerTool(
    "lab_insights",
    {
      title: "Lab insights",
      description:
        "How learners used LabMentor on one lab: questions per step, how they were answered, and ratings. " +
        "Use it to find the steps where the guide needs work.",
      inputSchema: { slug, days },
      annotations: READ_ONLY,
    },
    ({ slug, days }) =>
      safely(async () => {
        const i = await api.insights(slug, days);
        const confidence = i.averageConfidence === null ? "n/a" : `${Math.round(i.averageConfidence * 100)}%`;
        const steps = i.steps
          .filter((s) => s.questions > 0)
          .sort((a, b) => b.questions - a.questions)
          .map(
            (s) =>
              `- Step ${s.position} ${s.title}${s.graded ? " (graded)" : ""}: ${s.questions} questions, ` +
              `${s.needsInstructor} need the instructor, ${s.thumbsDown} rated not helpful`,
          );
        const policies = Object.entries(i.byPolicy)
          .map(([p, n]) => `${p} ${n}`)
          .join(", ");
        return [
          `${i.title}, last ${i.days} days: ${i.questions} questions from ${i.learners} learners.`,
          `Answers: ${policies}. Need the instructor: ${i.needsInstructor}. Rated helpful ${i.thumbsUp}, not helpful ${i.thumbsDown}. Average confidence ${confidence}.`,
          steps.length ? `Busiest steps:\n${steps.join("\n")}` : "No questions in this period.",
        ].join("\n\n");
      }),
  );

  server.registerTool(
    "open_questions",
    {
      title: "Questions that need the instructor",
      description:
        "Recent learner questions the guide did not answer, answered with low confidence, or rated not helpful. " +
        "Each is a candidate for a new troubleshooting note.",
      inputSchema: { slug, days, limit: z.number().int().min(1).max(20).default(10) },
      annotations: READ_ONLY,
    },
    ({ slug, days, limit }) =>
      safely(async () => {
        const open = (await api.insights(slug, days)).openQuestions.slice(0, limit);
        if (open.length === 0) return "Nothing waiting: every question in this period was answered from the guide.";
        return open
          .map(
            (q) =>
              `- "${q.question}" (${q.learner}, ${q.step ? `step ${q.step}` : "no step"}, ` +
              `${q.reason.replace(/_/g, " ")}, ${q.askedAt.slice(0, 10)})`,
          )
          .join("\n");
      }),
  );

  return server;
}
