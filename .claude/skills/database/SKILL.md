---
name: database
description: Schema, invariants, roles, migration mechanics and Postgres traps for the questionnaire platform's database. Use whenever writing or changing schema, migrations, repository code, seeds, or database tests, or when reasoning about transactions, locking, partitioning or grants.
---

# Database — working rules

Full reasoning lives in [[9-database-schema]]; [[2-design-doc#12. Database]] §12.1–12.2 carries the
summary. This skill is the operational distillation: what is true, what must not be broken, and what
has already bitten us.

## Stack

| Thing | Choice |
| --- | --- |
| Database | PostgreSQL 16 (`postgres:16-alpine` in compose) |
| Access | Drizzle ORM over the `pg` (node-postgres) driver |
| Migrations | `drizzle-kit` generating committed SQL files, applied by a one-shot `migrate` service |
| Pooling | `pg` pool in-process; PgBouncer is the first scaling step, not now |
| Schema file | `apps/backend/src/db/schema.ts` |
| Migration output | `apps/backend/drizzle/` |

No Postgres extensions are assumed. **Postgres 16 has no `uuidv7()`** — ids are generated in the
application.

## The schema at a glance

Three schemas. The split is not cosmetic: it is what makes the definition/execution grant barrier
structural instead of a per-table list someone has to remember to extend.

- **`definition`** — `question`, `question_version`, `question_version_option`, `questionnaire`,
  `questionnaire_version`, `questionnaire_item`, `version_question_index`
- **`execution`** — `session`, `response`
- **`audit`** — `event`

Roles: `qp_owner` owns everything and runs migrations. `qp_definition` and `qp_execution` are the two
application roles (two pools, two connection strings). `audit_owner` owns the audit schema and the
function that writes to it.

## Invariants — do not break these

Each one is enforced in the data layer on purpose. If a change makes one of these a service-layer
check instead, the change is wrong.

1. **A published questionnaire version is immutable.** Triggers reject `UPDATE` **and** `DELETE` on
   published rows. Draft items are guarded against their parent's status.
2. **A draft is structurally unreferenceable.** `version IS NULL` exactly when a row is a draft, so the
   `(questionnaire_id, id, version)` unique constraint makes composite FKs from `NOT NULL` columns
   match published rows only. A session cannot pin a draft; a questionnaire cannot point at another
   questionnaire's version. Never add a plain single-column FK to `questionnaire_version(id)` where the
   published-only property is wanted — it silently loses the guarantee.
3. **Question versions are append-only.** No `UPDATE`, no `DELETE`, ever. Editing a question means
   inserting version N+1.
4. **An invalid answer shape cannot be stored.** `response` has typed per-type columns under one check
   constraint. Adding a response type means extending that constraint in a migration.
5. **Collected responses are immutable.** `qp_execution` has `SELECT, INSERT` on `response` and nothing
   else. **No role has `DELETE` anywhere** in the schema.
6. **`audit.event` is append-only and unreachable directly.** Writes go through
   `audit.record(...)`, a `SECURITY DEFINER` function. `qp_definition` has no privilege on the table —
   not even `SELECT`.
7. **Nothing is deleted; things are hidden.** Questionnaires retire via `closes_at`, questions archive
   via `archived_at`. Apply this to any new entity.

## Rules for repository code

- **Pick the right role.** Definition repositories use the `qp_definition` pool; execution
  repositories use `qp_execution`. Never reach across — execution code must not read an authoring
  table, and the grants will stop it at runtime if it tries.
- **Take the lock first.** Three operations need a row lock as their *first* statement:

  | Operation | Lock |
  | --- | --- |
  | publish / create-draft / retire | `SELECT ... FROM definition.questionnaire WHERE id = $1 FOR UPDATE` |
  | create a question version | `SELECT ... FROM definition.question WHERE id = $1 FOR UPDATE` |
  | submit | `SELECT ... FROM execution.session WHERE id = $1 FOR UPDATE` |

  Publish additionally locks the version row before reading items, and must write
  `version_question_index` **before** flipping status or it trips its own item guard.
- **Check affected row counts.** The promoting `UPDATE ... WHERE status = 'draft'` is a
  compare-and-swap; assuming it succeeded defeats the point.
- **`created_at` on `response` is set explicitly**, never defaulted — to the session's `submitted_at`,
  so a session's rows share a partition and the replay read prunes to one.
- **Map `QP001` to `409`** in one place in the Fastify error handler. Map `23505` on the
  question-version path to `409` too.
- **Audit writes go through one repository function** that calls `audit.record(...)`, inside the same
  transaction as the domain change. Never inline an audit write at a call site.

## Rules for migrations

- **Generate first, then hand-edit.** For `execution.response`, let `drizzle-kit generate` emit the
  `CREATE TABLE`, then edit that file to append `PARTITION BY RANGE (created_at)` and the partition
  `CREATE`s. Declaring a table only in a hand-written migration leaves it out of drizzle-kit's snapshot
  JSON, so the next `generate` re-emits it and `migrate` dies on "already exists".
- **`drizzle-kit generate --custom`** for triggers, functions and grants. drizzle-kit emits none of them.
- **Roles are not migrations.** `CREATE ROLE ... LOGIN PASSWORD` goes in
  `docker-entrypoint-initdb.d`, from environment variables.
- **Pre-create partitions** (24–36 months). No `DEFAULT` partition — see the traps below.
- **The circular FK** (`questionnaire.current_version_id` ↔ `questionnaire_version`) must be added by
  `ALTER TABLE` after both tables exist. In Drizzle use the
  `references((): AnyPgColumn => ...)` form.
- **The seed publishes through the real service.** The triggers make inserting a published row
  impossible, and that is intentional — the seed is the first integration test of the publish path.

## Postgres traps, verified on this project

These are not general advice. Each one was reproduced against a live Postgres 16 while designing this
schema, and each one fails *silently* in the naive version.

- **A `CHECK` constraint passes when its expression is NULL.** `cardinality(NULL) = 1` is NULL, not
  false, so a choice answer with no choice inserts cleanly. Wrap type-dispatch checks in
  `COALESCE(CASE ... END, false)` and guard array elements with
  `array_position(arr, NULL) IS NULL`.
- **A status check inside a trigger needs `FOR SHARE`.** A bare `SELECT status` is a
  time-of-check/time-of-use race: a concurrent insert sees `draft` because the publish is still
  uncommitted, and the published snapshot and the item rows end up disagreeing with no error raised.
- **Guard reparenting explicitly.** A trigger that inspects
  `COALESCE(NEW.parent_id, OLD.parent_id)` lets an `UPDATE` move a row from a published parent to a
  draft one.
- **A `DEFAULT` partition blocks archival.** `DETACH PARTITION ... CONCURRENTLY` is refused outright
  while one exists (`55000`), and attaching a partition whose range overlaps rows already in the
  default is a hard error (`23514`), not a slow scan.
- **A unique index on a partitioned table must contain the partition key**, so it can never be global.
  Do not add one that looks like a cross-partition guarantee.
- **A `SECURITY DEFINER` function's owner needs `USAGE` on its schema.** If the function is owned by
  `audit_owner` but the schema is not, every call fails at runtime with `permission denied for schema
  audit` — long after the migration reported success. `ALTER SCHEMA audit OWNER TO audit_owner`.
- **`GRANT ... ON ALL TABLES IN SCHEMA` covers only tables that exist when it runs.** Pair it with
  `ALTER DEFAULT PRIVILEGES` or a later migration's table is unreachable at runtime.
- **`MATCH SIMPLE` skips the FK check when any referencing column is NULL** — which is what makes the
  nullable `current_version_id` / `current_version` pair behave correctly before anything is published.

## Local ops

```bash
docker compose up --build          # db → migrate (+seed) → backend → frontend
docker compose up db               # just Postgres, for running the backend on the host

npm run db:generate -w apps/backend   # drizzle-kit generate
npm run db:migrate  -w apps/backend
npm run db:seed     -w apps/backend

docker compose down -v             # drop the db-data volume; the only clean reset
```

Connect: `psql "$DATABASE_URL"`, or `docker compose exec db psql -U questionnaire -d questionnaire_platform`.

Tests run against a Testcontainers Postgres with a template database per Vitest worker; `TEST_DATABASE_URL`
is the escape hatch for pointing at an existing instance. See [[8-testing]].

## Not wired up yet

`docker-compose.yml` and `.env.example` currently define **one** Postgres user and **one**
`DATABASE_URL`. The schema needs four roles and the backend needs two connection strings
(`qp_definition`, `qp_execution`). Until that lands, compose does not yet enforce the grant barrier —
treat it as a known gap, not as evidence the barrier is optional.

## Where to read more

- [[9-database-schema]] — full DDL, triggers, grants, concurrency, indexing, alternatives
- [[2-design-doc#12. Database]] §12.1–12.2 — the summary and the normalized/snapshot split
- [[5-questionnaire-format#6. Versioning mechanics]] — what a response pins to and why
- [[7-application-boundary#3.2 Database grants]] — the role barrier
- [[6-observability#5. Audit trail]] — why audit is a table and not a log line
- [[3-scaling]] — partitioning, archival and the ordered levers
