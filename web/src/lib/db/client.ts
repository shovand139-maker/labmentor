import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { labmentorPool?: pg.Pool };

/** One pool per process. In development, hot reloads would otherwise open a new pool on every edit. */
export function pool(): pg.Pool {
  if (!globalForDb.labmentorPool) {
    globalForDb.labmentorPool = new pg.Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      // A request that cannot get a connection quickly should fail with 503, not hang.
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      application_name: "labmentor-web",
    });
  }
  return globalForDb.labmentorPool;
}

export function db(): Database {
  return drizzle(pool(), { schema });
}
