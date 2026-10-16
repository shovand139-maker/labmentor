/**
 * Prints a bearer token for one of the demo people, for the MCP server or for curl.
 *
 *   SESSION_SECRET=... npm run token -- --email priya.nair@contoso.example [--hours 24]
 *
 * The token carries the same claims as a session cookie, so row-level security and role checks apply.
 */
import { SignJWT } from "jose";
import { DEMO_USERS } from "../src/lib/demo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const secret = process.env.SESSION_SECRET;
const email = arg("email");
const hours = Number(arg("hours") ?? 24);
const user = DEMO_USERS.find((u) => u.email === email);

if (!secret || secret.length < 32 || !user || !(hours > 0 && hours <= 720)) {
  console.error(
    "Usage: SESSION_SECRET=<32+ chars> npm run token -- --email <demo email> [--hours 1-720]",
  );
  console.error(
    `Demo people: ${DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(", ")}`,
  );
  process.exit(1);
}

const token = await new SignJWT({
  tid: user.tenantId,
  role: user.role,
  name: user.name,
  email: user.email,
})
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject(user.id)
  .setIssuer("labmentor")
  .setAudience("labmentor-web")
  .setIssuedAt()
  .setExpirationTime(`${hours}h`)
  .sign(new TextEncoder().encode(secret));

console.log(token);
