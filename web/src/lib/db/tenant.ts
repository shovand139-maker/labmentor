import "server-only";
import { sql } from "drizzle-orm";
import type { Session } from "../auth/session";
import { db, type Database } from "./client";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Run `work` in a transaction scoped to the caller's tenant, user and role.
 *
 * `set_config(..., true)` lasts until the end of the transaction, so a pooled connection never carries one
 * request's tenant into the next. The row-level security policies read these values; without them every
 * table looks empty to the application role.
 */
export async function withTenant<T>(
  session: Session,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${session.tenantId}, true),
      set_config('app.user_id', ${session.userId}, true),
      set_config('app.role', ${session.role}, true)`);
    return work(tx);
  });
}
