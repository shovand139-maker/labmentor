import "server-only";
import { cookies } from "next/headers";
import { problem } from "../http";
import { readToken, SESSION_COOKIE, type Session } from "./session";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Guarded =
  { ok: true; session: Session } | { ok: false; response: Response };

function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  return header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : undefined;
}

function cookieToken(request: Request): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax already blocks most cross-site
 * requests; checking Origin covers the rest. Bearer tokens (the MCP server, scripts) are not sent by
 * browsers automatically, so they need no origin check.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function requireSession(
  request: Request,
  roles?: Session["role"][],
): Promise<Guarded> {
  const fromBearer = bearer(request);
  const session = await readToken(fromBearer ?? cookieToken(request));
  if (!session) {
    return {
      ok: false,
      response: problem(401, "unauthenticated", "Sign in to continue."),
    };
  }
  if (!fromBearer && UNSAFE.has(request.method) && !sameOrigin(request)) {
    return {
      ok: false,
      response: problem(
        403,
        "cross_origin",
        "This request must come from the LabMentor site.",
      ),
    };
  }
  if (roles && !roles.includes(session.role)) {
    return {
      ok: false,
      response: problem(403, "forbidden", "Your role cannot do this."),
    };
  }
  return { ok: true, session };
}

/** For server components and pages: the signed-in person, or null. */
export async function currentSession(): Promise<Session | null> {
  return readToken((await cookies()).get(SESSION_COOKIE)?.value);
}
