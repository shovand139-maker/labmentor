# AGENTS.md

Working agreement for anyone changing this repository. Each rule is here because breaking it is easy and costly to catch in review.

## Commands

| Task | Command |
|---|---|
| Assistant checks | `cd assistant && ruff check . && ruff format --check . && mypy && pytest` |
| Evals gate | `cd assistant && python -m labmentor_assistant.evals --cases ../evals/cases.yaml --labs ../content/labs` |
| Web checks | `cd web && npm run lint && npm run typecheck && npm test` |
| Database tests | `cd web && npm run db:migrate && npm run test:integration` (needs `DATABASE_URL` and `DATABASE_URL_OWNER`) |
| End to end | assistant on :8000, `npm run build && npm start` on :3000, then `npx playwright test` |

Database tests are skipped, not passed, without the database variables. A change to SQL or data access is not verified until they have run.

## Database

1. Every new table with tenant data gets a `tenant_id` column and, in the same migration, `ENABLE ROW LEVEL SECURITY` with policies. The test `covers every table that has a tenant_id` fails otherwise.
2. Data access goes through `withTenant(session, tx => …)`. Never add `where tenant_id = …` by hand and never use the owner connection in the app.
3. Grants are least privilege. If a feature needs a new write, grant that operation on that table (or those columns) only.
4. Migrations are generated with `npm run db:generate` and never edited after they are merged. Policies and grants go in custom migrations (`drizzle-kit generate --custom`).

## Assistant

5. Hints and solutions never reach the browser. `labGuide` is the learner-facing shape; `labForAssistant` is server to server only.
6. Every answer goes through `finalize` in `agent.py`. New output checks go there and get a unit test and, where it makes sense, an eval case.
7. A new safety rule gets a `safety` eval case. Safety cases must all pass; do not lower the gate to make a change pass.
8. Providers return the neutral `ModelReply`. Provider-specific shapes stay inside `providers/`.
9. Lab content lives in `content/labs/*.yaml`. When a guide changes, run the evals: retrieval depends on the wording.

## Web

10. Route handlers start with `requireSession` (and a role list where needed), validate bodies with `readJson` and a Zod schema, and return errors with `problem`.
11. Rendered text goes through `RichText`. Never use `dangerouslySetInnerHTML` for content from the database or the model.
12. Regenerate `web/package-lock.json` with the npm that CI uses (the one bundled with Node 24).

## Definition of done

1. The behavior change has a test that fails without it.
2. CI is green: assistant checks and evals, web checks, database tests, build and Playwright.
3. If answers change, the eval report in the CI artifacts was read, not just the pass rate.
