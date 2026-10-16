import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { issueToken, SESSION_COOKIE, SESSION_HOURS } from "@/lib/auth/session";
import { users } from "@/lib/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { DEMO_USERS, demoTenant } from "@/lib/demo";
import { env } from "@/lib/env";
import { problem, readJson } from "@/lib/http";
import { signInBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Demo sign-in: pick one of the seeded people. Disabled unless DEMO_SIGN_IN is true. */
export async function POST(request: Request): Promise<Response> {
  if (!env().DEMO_SIGN_IN)
    return problem(404, "not_found", "Demo sign-in is turned off.");
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return problem(403, "cross_origin", "Sign in from the LabMentor site.");
  }
  const body = await readJson(request, signInBody);
  if (!body.ok) return body.response;

  const person = DEMO_USERS.find((u) => u.id === body.data.userId);
  if (!person)
    return problem(
      404,
      "unknown_user",
      "There is no demo person with that id.",
    );
  const session = {
    userId: person.id,
    tenantId: person.tenantId,
    role: person.role,
    name: person.name,
    email: person.email,
  };
  const [stored] = await withTenant(session, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.id, person.id)),
  );
  if (!stored) return problem(409, "not_seeded", "Run npm run db:seed first.");

  const response = NextResponse.json({
    name: person.name,
    role: person.role,
    tenant: demoTenant(person.tenantId)?.name,
  });
  response.cookies.set(SESSION_COOKIE, await issueToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return response;
}

export async function DELETE(): Promise<Response> {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
