import "server-only";
import { redirect } from "next/navigation";
import { currentSession } from "./auth/guard";
import type { Session } from "./auth/session";
import { tenants } from "./db/schema";
import { withTenant } from "./db/tenant";

/** For pages: the signed-in person and their organization's name, or a redirect to sign in. */
export async function pageSession(): Promise<{
  session: Session;
  organization: string | null;
}> {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const [tenant] = await withTenant(session, (tx) =>
    tx.select({ name: tenants.name }).from(tenants),
  );
  if (!tenant) redirect("/sign-in");
  return { session, organization: tenant.name };
}
