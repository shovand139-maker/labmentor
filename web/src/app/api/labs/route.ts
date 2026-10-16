import { requireSession } from "@/lib/auth/guard";
import { withTenant } from "@/lib/db/tenant";
import { json } from "@/lib/http";
import { listLabs } from "@/lib/repos/labs";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) return guard.response;
  const { session } = guard;
  return json({
    labs: await withTenant(session, (tx) => listLabs(tx, session.userId)),
  });
}
