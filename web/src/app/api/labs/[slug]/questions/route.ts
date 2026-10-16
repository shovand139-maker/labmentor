import { askAssistant, assistantRequest } from "@/lib/assistant";
import { requireSession } from "@/lib/auth/guard";
import { withTenant } from "@/lib/db/tenant";
import { env } from "@/lib/env";
import { problem, readJson } from "@/lib/http";
import {
  addAnswer,
  addQuestion,
  conversationFor,
  questionsInLastMinute,
  recentTurns,
} from "@/lib/repos/conversations";
import { completedSteps, currentStep, labForAssistant } from "@/lib/repos/labs";
import { encodeEvent } from "@/lib/sse";
import { questionBody, slugParam } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Ask a question about a lab. Responds with server-sent events:
 *
 *   accepted  the stored question
 *   tool      the assistant is searching the guide, checking progress or fetching a hint
 *   delta     a piece of the answer text
 *   done      the stored answer with its citations and policy
 *   error     the assistant could not answer; the question stays in the conversation
 *
 * The question is stored before the assistant is called and the answer after it finishes, each in its own
 * short transaction, so no database connection is held while the model is working.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) return guard.response;
  const { session } = guard;
  const slug = slugParam.safeParse((await params).slug);
  if (!slug.success)
    return problem(
      404,
      "lab_not_found",
      "There is no lab with that name in your organization.",
    );
  const body = await readJson(request, questionBody);
  if (!body.ok) return body.response;

  const prepared = await withTenant(session, async (tx) => {
    const lab = await labForAssistant(tx, slug.data);
    if (!lab) return { kind: "missing" } as const;
    const conversationId = await conversationFor(tx, session, lab.id);
    if (
      (await questionsInLastMinute(tx, conversationId)) >=
      env().QUESTIONS_PER_MINUTE
    ) {
      return { kind: "limited" } as const;
    }
    const completed = await completedSteps(tx, lab.id, session.userId);
    const step = currentStep(lab.steps.length, completed);
    const history = await recentTurns(tx, conversationId);
    const question = await addQuestion(
      tx,
      session,
      conversationId,
      body.data.question,
      step,
    );
    return {
      kind: "ready",
      lab,
      conversationId,
      completed,
      step,
      history,
      question,
    } as const;
  });
  if (prepared.kind === "missing") {
    return problem(
      404,
      "lab_not_found",
      "There is no lab with that name in your organization.",
    );
  }
  if (prepared.kind === "limited") {
    return problem(
      429,
      "slow_down",
      "That's a lot of questions in a minute. Give the last answer a read first.",
      {
        headers: { "Retry-After": "60" },
      },
    );
  }

  const { lab, conversationId, completed, step, history, question } = prepared;
  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(encodeEvent(event, data)));
        } catch {
          // The browser went away. The assistant call is aborted through request.signal.
        }
      };
      send("accepted", { question });
      try {
        const events = askAssistant(
          assistantRequest(lab, question.content, step, completed, history),
          request.signal,
        );
        for await (const event of events) {
          if (event.type === "tool") {
            send("tool", {
              name: event.name,
              status: event.status,
              summary: event.summary,
            });
          } else if (event.type === "delta") {
            send("delta", { text: event.text });
          } else if (event.type === "error") {
            send("error", { code: event.code, message: event.message });
            break;
          } else {
            const r = event.result;
            const answer = await withTenant(session, (tx) =>
              addAnswer(tx, session, conversationId, step, {
                answer: r.answer,
                citations: r.citations,
                policy: r.policy,
                needsInstructor: r.needs_instructor,
                confidence: r.confidence,
                tools: r.tools,
                flags: r.flags,
                model: r.model,
                inputTokens: r.usage.input_tokens,
                outputTokens: r.usage.output_tokens,
                latencyMs: Date.now() - started,
              }),
            );
            send("done", { answer });
          }
        }
      } catch (error) {
        console.error("question failed", error);
        send("error", {
          code: "internal",
          message: "Something went wrong while answering. Try again.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
