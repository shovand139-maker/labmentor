import { tenants } from "@/lib/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { requireSession } from "@/lib/auth/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) return guard.response;
  const { session } = guard;
  const [tenant] = await withTenant(session, (tx) =>
    tx.select({ name: tenants.name }).from(tenants),
  );
  return json({
    name: session.name,
    email: session.email,
    role: session.role,
    organization: tenant?.name ?? null,
  });
}
