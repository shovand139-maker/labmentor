import { pool } from "@/lib/db/client";
import { env } from "@/lib/env";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

async function check(work: () => Promise<unknown>): Promise<"ok" | "down"> {
  try {
    await work();
    return "ok";
  } catch {
    return "down";
  }
}

/** Liveness by default; `?ready` also checks the database and the assistant, for the load balancer. */
export async function GET(request: Request): Promise<Response> {
  if (!new URL(request.url).searchParams.has("ready"))
    return json({ status: "ok" });
  const [database, assistant] = await Promise.all([
    check(() => pool().query("select 1")),
    check(async () => {
      const response = await fetch(new URL("/health", env().ASSISTANT_URL), {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error(String(response.status));
    }),
  ]);
  const ok = database === "ok" && assistant === "ok";
  return json(
    { status: ok ? "ok" : "degraded", database, assistant },
    { status: ok ? 200 : 503 },
  );
}
