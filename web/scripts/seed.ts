/**
 * Loads the demo organizations, people and labs. Labs come from ../content/labs/*.yaml, the same files the
 * assistant's evals read, so the questions in evals/cases.yaml are asked against exactly this content.
 *
 *   npm run db:seed            (DATABASE_URL_OWNER)
 *
 * Re-running is safe: organizations, people and labs are upserted and lab steps are replaced.
 */
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parse } from "yaml";
import { DEMO_TENANTS, DEMO_USERS } from "../src/lib/demo";

type LabFile = {
  slug: string;
  title: string;
  summary: string;
  duration_minutes: number;
  tenants: string[];
  steps: {
    title: string;
    body: string;
    graded?: boolean;
    hints?: Record<string, string>;
    solution?: string[];
  }[];
  faq?: { question: string; answer: string }[];
};

const CONTENT = new URL("../../content/labs/", import.meta.url);

export async function loadLabFiles(): Promise<LabFile[]> {
  const names = (await readdir(CONTENT))
    .filter((n) => n.endsWith(".yaml"))
    .sort();
  return Promise.all(
    names.map(
      async (n) =>
        parse(await readFile(new URL(n, CONTENT), "utf8")) as LabFile,
    ),
  );
}

export async function seedDatabase(
  ownerUrl: string,
): Promise<{ labs: number }> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  let count = 0;
  try {
    await client.query("BEGIN");
    for (const t of DEMO_TENANTS) {
      await client.query(
        `INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
        [t.id, t.slug, t.name],
      );
    }
    for (const u of DEMO_USERS) {
      await client.query(
        `INSERT INTO users (id, tenant_id, email, name, role) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role`,
        [u.id, u.tenantId, u.email, u.name, u.role],
      );
    }
    for (const lab of await loadLabFiles()) {
      for (const slug of lab.tenants) {
        const tenant = DEMO_TENANTS.find((t) => t.slug === slug);
        if (!tenant)
          throw new Error(`lab ${lab.slug} names unknown tenant ${slug}`);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO labs (tenant_id, slug, title, summary, duration_minutes) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, slug) DO UPDATE
             SET title = EXCLUDED.title, summary = EXCLUDED.summary,
                 duration_minutes = EXCLUDED.duration_minutes, updated_at = now()
           RETURNING id`,
          [tenant.id, lab.slug, lab.title, lab.summary, lab.duration_minutes],
        );
        const labId = rows[0]!.id;
        await client.query("DELETE FROM lab_steps WHERE lab_id = $1", [labId]);
        await client.query("DELETE FROM lab_faq WHERE lab_id = $1", [labId]);
        for (const [i, step] of lab.steps.entries()) {
          await client.query(
            `INSERT INTO lab_steps (tenant_id, lab_id, position, title, body, graded, hints, solution)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              tenant.id,
              labId,
              i + 1,
              step.title,
              step.body.trim(),
              step.graded ?? false,
              JSON.stringify(step.hints ?? {}),
              JSON.stringify(step.solution ?? []),
            ],
          );
        }
        for (const [i, entry] of (lab.faq ?? []).entries()) {
          await client.query(
            "INSERT INTO lab_faq (tenant_id, lab_id, position, question, answer) VALUES ($1, $2, $3, $4, $5)",
            [tenant.id, labId, i + 1, entry.question, entry.answer.trim()],
          );
        }
        count += 1;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  return { labs: count };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error("DATABASE_URL_OWNER is required");
    process.exit(1);
  }
  seedDatabase(url)
    .then(({ labs }) =>
      console.log(
        `seeded ${DEMO_TENANTS.length} organizations, ${DEMO_USERS.length} people, ${labs} labs`,
      ),
    )
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
