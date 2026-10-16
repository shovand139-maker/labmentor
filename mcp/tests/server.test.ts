import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { LabMentorApi } from "../src/api.js";
import { createServer } from "../src/server.js";

type Route = (url: URL, init?: RequestInit) => Response;

const INSIGHTS = {
  slug: "aca-first-container",
  title: "Deploy your first container",
  days: 30,
  learners: 2,
  questions: 5,
  byPolicy: { answered: 2, hint_only: 0, solution_withheld: 2, not_in_guide: 1 },
  needsInstructor: 1,
  thumbsUp: 1,
  thumbsDown: 0,
  averageConfidence: 0.52,
  steps: [
    { position: 1, title: "Sign in", graded: false, questions: 1, needsInstructor: 0, thumbsDown: 0 },
    { position: 3, title: "Create the environment", graded: true, questions: 4, needsInstructor: 1, thumbsDown: 0 },
  ],
  openQuestions: [
    { learner: "Ben Ortiz", question: "How do I set up a VPN?", step: 3, reason: "not_in_guide", askedAt: "2026-10-16T08:00:00Z" },
  ],
};

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
});

async function connect(route: Route) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return route(url, init);
  }) as typeof fetch;
  const server = createServer(new LabMentorApi("https://labmentor.test", "token-123", fakeFetch));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
}

describe("LabMentor MCP server", () => {
  it("offers four read-only tools", async () => {
    const { client } = await connect(() => json({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_lab_guide", "lab_insights", "list_labs", "open_questions"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("calls the API with the instructor's bearer token", async () => {
    const { client, calls } = await connect(() =>
      json({
        labs: [{ slug: "aca-first-container", title: "Deploy", summary: "", durationMinutes: 45, steps: 7, solutionsAllowed: false }],
      }),
    );
    const result = await client.callTool({ name: "list_labs", arguments: {} });
    expect(textOf(result)).toContain("aca-first-container: Deploy (7 steps, 45 min)");
    expect(calls[0]!.url.pathname).toBe("/api/labs");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer token-123");
  });

  it("summarises insights with the busiest step first", async () => {
    const { client, calls } = await connect(() => json(INSIGHTS));
    const result = await client.callTool({ name: "lab_insights", arguments: { slug: "aca-first-container", days: 7 } });
    const body = textOf(result);
    expect(calls[0]!.url.search).toBe("?lab=aca-first-container&days=7");
    expect(body).toContain("5 questions from 2 learners");
    expect(body.indexOf("Step 3")).toBeLessThan(body.indexOf("Step 1"));
  });

  it("lists the questions that need the instructor", async () => {
    const { client } = await connect(() => json(INSIGHTS));
    const result = await client.callTool({ name: "open_questions", arguments: { slug: "aca-first-container" } });
    expect(textOf(result)).toContain('"How do I set up a VPN?" (Ben Ortiz, step 3, not in guide, 2026-10-16)');
  });

  it("reports a learner token as a tool error the model can explain", async () => {
    const { client } = await connect(() => json({ detail: "Your role cannot do this." }, 403));
    const result = await client.callTool({ name: "lab_insights", arguments: { slug: "aca-first-container" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("instructor token");
  });

  it("rejects malformed slugs before calling the API", async () => {
    const { client, calls } = await connect(() => json({}));
    const result = await client.callTool({ name: "get_lab_guide", arguments: { slug: "../admin" } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
