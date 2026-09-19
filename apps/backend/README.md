# @qp/backend

Fastify + TypeScript API for the questionnaire platform: questionnaire definition (authoring,
publishing) and execution (sessions, responses). See
[`docs/2-design-doc.md`](../../docs/2-design-doc.md) §9–§11 for the API and service boundary, and
[`docs/7-application-boundary.md`](../../docs/7-application-boundary.md) for how this app's modules
relate to `packages/shared` and `packages/telemetry`.

> **Status:** `src/index.ts` serves the three API modules and `/health/live` (process up, no database; `/health` is an alias), and `/health/ready` (`SELECT 1` on the definition, execution and reporting pools; `503` with the failing roles in `detail`).
> `eslint.config.mjs` enforces that `src/modules/definition` and `src/modules/execution` never
> import each other and that only `packages/telemetry` imports `pino` or `@opentelemetry/*`.

## Configuration

`src/config.ts` is the single place environment variables are read. Deployment (Docker Compose or
Kubernetes) supplies them as plain environment variables — see `docs/2-design-doc.md` §13
("environment variables only, with a committed `.env.example`; no secrets in images"). See the root
[`.env.example`](../../.env.example) for the full variable list and defaults.

## Database

Postgres via Drizzle ORM (`src/db/`). The design is [`docs/9-database-schema.md`](../../docs/9-database-schema.md);
the working rules are in [`.claude/skills/database/SKILL.md`](../../.claude/skills/database/SKILL.md).

- `schema.ts` describes the `definition`, `execution` and `audit` schemas. `drizzle/` holds the committed
  migrations: `0000_schema.sql` is generated from `schema.ts`, and each later file is either generated or a
  `--custom` migration for triggers, grants, partitions or functions, named for the guarantee it carries.
- A published version exists only through `definition.promote_draft`, a `SECURITY DEFINER` function that
  promotes the draft, writes `version_question_index` and moves the current-version pointer in one call.
  `qp_definition` has no `UPDATE` on those columns. `publishDraft` takes the locks, runs `validateDraft`,
  calls the function, then writes the `publish` audit row in the same transaction.
- The execution side reads questionnaire versions only through `definition.published_questionnaire_version`,
  a `security_barrier` view of published rows (id, questionnaire_id, version, title, snapshot,
  format_version, published_at). `qp_execution` has no `SELECT` on the base `questionnaire_version` table.
- `migrate.ts` is the one-shot runner the compose `migrate` service calls. It applies the migrations as
  `qp_owner` (`DATABASE_URL_OWNER`) and pre-creates the next 24 monthly `response` partitions.
- `seed/` runs next, as `qp_definition` (`DATABASE_URL_DEFINITION`), and publishes the demo questionnaire
  through the real publish transaction. It is idempotent. See [`src/db/seed/README.md`](src/db/seed/README.md).
- Roles are not migrations: `db/init/01-roles.sh` creates them, and the compose `roles` service re-applies it
  before `migrate` on every `up`, so a new role or changed password reaches an existing volume.

## Hand-edited migrations

Drizzle has no way to express two things this schema needs, so `drizzle/0000_schema.sql` carries two edits
made by hand after `drizzle-kit generate` produced it:

| Edit | Why |
| --- | --- |
| `PARTITION BY RANGE ("created_at")` on `execution.response` | Monthly partitions with no default ([`docs/9-database-schema.md`](../../docs/9-database-schema.md) §6.4). A table cannot be converted to partitioned later, so it has to be on the generated `CREATE TABLE`, which keeps drizzle-kit's snapshot truthful (§11.1) |
| `DEFERRABLE INITIALLY IMMEDIATE` on `item_position_unique` | A reorder swaps positions with separate `UPDATE`s under `SET CONSTRAINTS ... DEFERRED` (§3.3) |

Neither edit is in drizzle-kit's snapshot, and drizzle's migrator records a migration as applied and never
looks at the file again. Each of these loses an edit **without any error**:

- Regenerating or squashing `0000`. The new file has neither edit.
- Changing `item_position_unique` in `schema.ts`. `generate` drops the constraint and adds it back
  without `DEFERRABLE`.
- Editing a migration that has already been applied. Existing databases never see the change.

So:

- Never edit, regenerate or squash a committed migration. `drizzle/migrations.lock.json` pins every
  `.sql` file to its sha256, and `_tests/db/migration-lock.test.ts` fails if one changes, goes missing, or a
  new one is not yet in the lock. Add a new migration's hash to the lock after reviewing it.
- Read any generated SQL that touches `execution.response` or `questionnaire_item` by hand before
  committing it. Also check the statement order: when one `generate` added both
  `session_pinned_version_key` and the foreign key referencing it, drizzle-kit put the foreign key first,
  which Postgres rejects. That is why `0011` and `0012` are two separate generated migrations.
- If an edit is ever lost, restore it in a new `--custom` migration. Don't patch the old file.

The guard tests:

- `_tests/db/hand-edits.test.ts` checks the migrated catalog: `response` is range-partitioned on
  `created_at`, and the constraint is deferrable and initially immediate. A deferred swap succeeds, and
  the same swap without deferral fails `23505`.
- `_tests/db/schema-drift.test.ts` runs `drizzle-kit generate` against a temporary copy of `drizzle/` and
  fails unless it reports no schema changes.
- `_tests/db/migration-lock.test.ts` is the lock described above.

## Migrations that refuse existing data

`0015_other_option_id_reserved.sql` reserves the option id `other` for the freeform option ([Decisions Log](../../docs/2-design-doc.md) #83). Before PR 2c the API accepted a plain option under `other`, so a database written to before then may hold one. The migration then stops before changing anything and raises `23514`, listing each question version and option that breaks the rule. Every pending migration runs in one transaction, so the database stays on `0014`, and compose does not start the backend.

Nothing can repair such a row. Question versions are append-only and published ones immutable (#13), so a migration that made the option freeform, or deleted it, would change what an existing version asked and what its responses mean. For a development or demo database, reset it: `docker compose down -v`, then `docker compose up --build`. No production deployment exists. Before one does, any database that has taken questions from clients other than the admin editor has to be checked with the query at the top of `0015`.

The check at the top of `0015` is written by hand into the generated file. Like the `0000` edits, it survives only because committed migrations are never regenerated, and `migrations.lock.json` pins it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev -w apps/backend` | Fastify on `:3000` with reload (needs a reachable Postgres — see `.env.example`) |
| `npm run build -w apps/backend` | Compile to `dist/` |
| `npm run test -w apps/backend` | Run this package's tests (vitest, `_tests/`) |
| `npm run typecheck -w apps/backend` | Typecheck `src/` and `_tests/` |
| `npm run db:generate -w apps/backend` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate -w apps/backend` | Apply migrations and pre-create partitions (needs `DATABASE_URL_OWNER`) |
| `npm run db:seed -w apps/backend` | Publish the demo questionnaire (needs `DATABASE_URL_DEFINITION`) |
