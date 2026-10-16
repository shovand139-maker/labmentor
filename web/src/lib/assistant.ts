import "server-only";
import { z } from "zod";
import { env } from "./env";
import type { AssistantLab } from "./repos/labs";
import { readEvents } from "./sse";

/** The assistant's result, validated: it is another service, and its output is stored and shown to people. */
const result = z.object({
  answer: z.string().max(10_000),
  citations: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        step: z.number().int().nullable(),
      }),
    )
    .max(20),
  policy: z.enum([
    "answered",
    "hint_only",
    "solution_withheld",
    "not_in_guide",
  ]),
  needs_instructor: z.boolean(),
  confidence: z.number().min(0).max(1),
  tools: z
    .array(z.object({ name: z.string(), ok: z.boolean(), summary: z.string() }))
    .max(50),
  model: z.string(),
  usage: z.object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
  }),
  flags: z.array(z.string()).default([]),
});

export type AssistantResult = z.infer<typeof result>;

export type AssistantEvent =
  | {
      type: "tool";
      name: string;
      status: "running" | "done" | "error";
      summary?: string;
    }
  | { type: "delta"; text: string }
  | { type: "done"; result: AssistantResult }
  | { type: "error"; code: string; message: string };

export type AssistantRequest = {
  lab: {
    slug: string;
    title: string;
    solutions_allowed: boolean;
    steps: AssistantLab["steps"];
    faq: AssistantLab["faq"];
  };
  question: string;
  current_step: number | null;
  completed_steps: number[];
  history: { role: "user" | "assistant"; content: string }[];
};

export function assistantRequest(
  lab: AssistantLab,
  question: string,
  currentStep: number | null,
  completed: number[],
  history: { role: "user" | "assistant"; content: string }[],
): AssistantRequest {
  return {
    lab: {
      slug: lab.slug,
      title: lab.title,
      solutions_allowed: lab.solutionsAllowed,
      steps: lab.steps,
      faq: lab.faq,
    },
    question,
    current_step: currentStep,
    completed_steps: completed,
    history: history.map((t) => ({
      role: t.role,
      content: t.content.slice(0, 8_000),
    })),
  };
}

const toolEvent = z.object({
  name: z.string(),
  status: z.enum(["running", "done", "error"]),
  summary: z.string().optional(),
});

/** Ask the assistant and yield its events. Network and protocol failures become a single error event. */
export async function* askAssistant(
  body: AssistantRequest,
  signal?: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  const { ASSISTANT_URL, ASSISTANT_SERVICE_KEY } = env();
  let response: Response;
  try {
    response = await fetch(new URL("/v1/answer", ASSISTANT_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(ASSISTANT_SERVICE_KEY
          ? { "x-service-key": ASSISTANT_SERVICE_KEY }
          : {}),
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
        : AbortSignal.timeout(90_000),
    });
  } catch (error) {
    if (signal?.aborted) return;
    console.error("assistant unreachable", error);
    yield {
      type: "error",
      code: "assistant_unavailable",
      message: "The assistant is not reachable right now.",
    };
    return;
  }
  if (!response.ok || !response.body) {
    console.error("assistant returned", response.status);
    yield {
      type: "error",
      code: "assistant_unavailable",
      message: "The assistant could not answer right now.",
    };
    return;
  }

  let finished = false;
  for await (const { event, data } of readEvents(response.body)) {
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (event === "tool") {
      const parsed = toolEvent.safeParse(payload);
      if (parsed.success) yield { type: "tool", ...parsed.data };
    } else if (event === "delta") {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === "string") yield { type: "delta", text };
    } else if (event === "done") {
      const parsed = result.safeParse(payload);
      finished = true;
      if (parsed.success) yield { type: "done", result: parsed.data };
      else
        yield {
          type: "error",
          code: "assistant_protocol",
          message: "The assistant sent an answer we could not read.",
        };
    } else if (event === "error") {
      finished = true;
      const message = (payload as { message?: unknown }).message;
      yield {
        type: "error",
        code: "assistant_failed",
        message:
          typeof message === "string"
            ? message
            : "The assistant could not answer.",
      };
    }
  }
  if (!finished && !signal?.aborted) {
    yield {
      type: "error",
      code: "assistant_interrupted",
      message: "The answer was cut off. Try asking again.",
    };
  }
}
