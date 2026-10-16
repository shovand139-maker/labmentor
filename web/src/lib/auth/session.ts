import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { env } from "../env";

export const SESSION_COOKIE = "lm_session";
export const SESSION_HOURS = 8;
const ISSUER = "labmentor";
const AUDIENCE = "labmentor-web";

const claims = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  role: z.enum(["learner", "instructor"]),
  name: z.string().min(1),
  email: z.email(),
});

export type Session = {
  userId: string;
  tenantId: string;
  role: "learner" | "instructor";
  name: string;
  email: string;
};

function key(secret = env().SESSION_SECRET): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueToken(
  session: Session,
  options: { hours?: number; secret?: string } = {},
): Promise<string> {
  return new SignJWT({
    tid: session.tenantId,
    role: session.role,
    name: session.name,
    email: session.email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(session.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${options.hours ?? SESSION_HOURS}h`)
    .sign(key(options.secret));
}

/** Returns the session for a valid token, or null for a missing, expired, forged or malformed one. */
export async function readToken(
  token: string | undefined,
  secret?: string,
): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const parsed = claims.safeParse(payload);
    if (!parsed.success) return null;
    const { sub, tid, role, name, email } = parsed.data;
    return { userId: sub, tenantId: tid, role, name, email };
  } catch {
    return null;
  }
}
