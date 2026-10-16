/**
 * Applies the SQL migrations in ./drizzle as the owner role.
 *
 *   npm run db:migrate -- [--create-database]
 *
 * DATABASE_URL_OWNER  owner connection (tables are created by and belong to this role)
 * APP_DB_PASSWORD     when set, creates or updates the labmentor_app login with this password (local and CI).
 *                     In Azure, labmentor_app is the web app's managed identity, created with
 *                     pgaadauth_create_principal before the first deploy, and this variable is not set.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const APP_ROLE = "labmentor_app";

async function createDatabaseIfMissing(ownerUrl: string): Promise<void> {
  const url = new URL(ownerUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const exists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database],
    );
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(database)}`);
      console.log(`created database ${database}`);
    }
  } finally {
    await admin.end();
  }
}

async function ensureAppRole(
  client: pg.Client,
  password: string | undefined,
): Promise<void> {
  const existing = await client.query(
    "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1",
    [APP_ROLE],
  );
  if (password) {
    const verb = existing.rowCount ? "ALTER" : "CREATE";
    await client.query(
      `${verb} ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pg.escapeLiteral(password)}`,
    );
  } else if (!existing.rowCount) {
    throw new Error(
      `role ${APP_ROLE} does not exist. Set APP_DB_PASSWORD, or create the Entra principal first.`,
    );
  }
  const role = await client.query(
    "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1",
    [APP_ROLE],
  );
  if (role.rows[0]?.rolbypassrls || role.rows[0]?.rolsuper) {
    throw new Error(
      `${APP_ROLE} must not be a superuser or bypass row-level security`,
    );
  }
}

async function main(): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL_OWNER;
  if (!ownerUrl) throw new Error("DATABASE_URL_OWNER is required");
  if (process.argv.includes("--create-database"))
    await createDatabaseIfMissing(ownerUrl);

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await ensureAppRole(client, process.env.APP_DB_PASSWORD);
    await migrate(drizzle(client), {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
    const applied = await client.query(
      "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
    );
    console.log(`migrations applied: ${applied.rows[0].n}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
