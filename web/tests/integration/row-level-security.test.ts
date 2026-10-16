import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_TENANTS, DEMO_USERS } from "@/lib/demo";
import { seedDatabase } from "../../scripts/seed";

/** Runs against a migrated database: DATABASE_URL (app role) and DATABASE_URL_OWNER. See README. */
const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_URL_OWNER;
const run = appUrl && ownerUrl ? describe : describe.skip;

const [contoso, fabrikam] = DEMO_TENANTS;
const asha = DEMO_USERS.find((u) => u.name === "Asha Rao")!;
const ben = DEMO_USERS.find((u) => u.name === "Ben Ortiz")!;
const priya = DEMO_USERS.find((u) => u.name === "Priya Nair")!;

run("row-level security for the application role", () => {
  const app = new pg.Pool({ connectionString: appUrl, max: 2 });

  async function as<T>(
    user: { tenantId: string; id: string; role: string } | null,
    sql: string,
    params: unknown[] = [],
  ) {
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      if (user) {
        await client.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)",
          [user.tenantId, user.id, user.role],
        );
      }
      const result = await client.query(sql, params);
      await client.query("COMMIT");
      return result.rows as T[];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    await seedDatabase(ownerUrl!);
  });
  afterAll(() => app.end());

  it("shows nothing when no tenant is set", async () => {
    expect(await as(null, "select * from labs")).toEqual([]);
    expect(await as(null, "select * from users")).toEqual([]);
  });

  it("shows each organization only its own labs", async () => {
    const mine = await as<{ slug: string }>(
      asha,
      "select slug from labs order by slug",
    );
    const theirs = await as<{ slug: string }>(
      {
        ...DEMO_USERS.find((u) => u.tenantId === fabrikam!.id)!,
        tenantId: fabrikam!.id,
      },
      "select slug from labs order by slug",
    );
    expect(mine.map((l) => l.slug)).toEqual([
      "aca-first-container",
      "sql-row-level-security",
    ]);
    expect(theirs.map((l) => l.slug)).toEqual([
      "aca-first-container",
      "aks-entra-rbac",
    ]);
  });

  it("refuses rows written into another organization", async () => {
    const [lab] = await as<{ id: string }>(
      asha,
      "select id from labs where slug = 'aca-first-container'",
    );
    await expect(
      as(
        { ...asha, tenantId: fabrikam!.id },
        "insert into conversations (tenant_id, user_id, lab_id) values ($1, $2, $3)",
        [contoso!.id, asha.id, lab!.id],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps learners out of each other's conversations, but lets instructors read them", async () => {
    const [lab] = await as<{ id: string }>(
      asha,
      "select id from labs where slug = 'sql-row-level-security'",
    );
    await as(
      asha,
      "insert into conversations (tenant_id, user_id, lab_id) values ($1, $2, $3) on conflict do nothing",
      [contoso!.id, asha.id, lab!.id],
    );
    const [conversation] = await as<{ id: string }>(
      asha,
      "select id from conversations where lab_id = $1 and user_id = $2",
      [lab!.id, asha.id],
    );
    await as(
      asha,
      "insert into messages (tenant_id, conversation_id, role, content) values ($1, $2, 'user', 'private question')",
      [contoso!.id, conversation!.id],
    );

    expect(
      await as(ben, "select * from messages where conversation_id = $1", [
        conversation!.id,
      ]),
    ).toEqual([]);
    expect(
      (
        await as(priya, "select * from messages where conversation_id = $1", [
          conversation!.id,
        ])
      ).length,
    ).toBeGreaterThan(0);
    await expect(
      as(
        ben,
        "insert into messages (tenant_id, conversation_id, role, content) values ($1, $2, 'assistant', 'spoof')",
        [contoso!.id, conversation!.id],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("only lets instructors change lab settings, and nobody delete labs", async () => {
    const asLearner = await as(
      asha,
      "update labs set solutions_allowed = true where slug = 'aca-first-container' returning slug",
    );
    const asInstructor = await as(
      priya,
      "update labs set solutions_allowed = false where slug = 'aca-first-container' returning slug",
    );
    expect(asLearner).toEqual([]);
    expect(asInstructor).toHaveLength(1);
    await expect(as(priya, "delete from labs")).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(priya, "update lab_steps set body = 'x'")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("covers every table that has a tenant_id", async () => {
    const owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    try {
      const { rows } = await owner.query<{ table_name: string }>(`
        select c.table_name from information_schema.columns c
        join pg_class t on t.relname = c.table_name and t.relkind = 'r'
        where c.table_schema = 'public' and c.column_name = 'tenant_id' and not t.relrowsecurity`);
      expect(rows).toEqual([]);
    } finally {
      await owner.end();
    }
  });
});
