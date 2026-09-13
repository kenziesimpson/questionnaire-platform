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
   published rows, and `INSERT` of a row already `published`. Draft items are guarded against their
   parent's status.
2. **A draft is structurally unreferenceable.** `version IS NULL` exactly when a row is a draft, so the
   `(questionnaire_id, id, version)` unique constraint makes composite FKs from `NOT NULL` columns
   match published rows only. A session cannot pin a draft; a questionnaire cannot point at another
   questionnaire's version. Never add a plain single-column FK to `questionnaire_version(id)` where the
   published-only property is wanted — it silently loses the guarantee.
3. **Question versions are append-only.** No `UPDATE`, no `DELETE`, ever. Editing a question means
   inserting version N+1.
   **There are five response types** — `text`, `single_choice`, `multiple_choice`, `number`, `date`. Do not
   add `yes_no`: it was removed deliberately (Decisions Log #36) and a yes/no question is a `single_choice`
   with reserved option ids `yes` / `no` seeded by an editor template, not enforced by the schema.
4. **An invalid answer shape cannot be stored** — with one stated exception. `response` has typed per-type
   columns under one check constraint. Adding a response type means extending that constraint in a
   migration. The exception: **duplicate ids within a `multiple_choice` answer's `option_ids` are not
   caught by the constraint** — a `CHECK` cannot hold the subquery de-duplication needs — and are the
   submit validator's job instead (Decisions Log #34). Do not assume a `response` row read back from the
   database has distinct `option_ids`.
5. **Collected responses are immutable.** `qp_execution` has `SELECT, INSERT` on `response` and nothing
   else, and a response's `questionnaire_version_id` must match its session's pin (composite FK). **The
   only `DELETE` any application role holds is `qp_definition` on `questionnaire_item`**, bounded to
   drafts by the item guard. Do not grant another.
6. **`audit.event` is append-only and unreachable directly.** Writes go through
   `audit.record(...)`, a `SECURITY DEFINER` function. `qp_definition` has no privilege on the table —
   not even `SELECT`.
7. **Nothing is deleted; things are hidden.** Questionnaires retire via `closes_at`, questions archive
   via `archived_at`. Apply this to any new entity.

## Rules for repository code

- **Never fold unpersisted data into `response_digest`.** It is SHA-256 over the canonicalized `response`
  rows and must stay a pure function of them, so a canonicalization change is a backfill rather than a
  permanent choice (Decisions Log #37). No session id, no timestamps, no client version.
- **Seed ids are hardcoded constants.** Question and questionnaire ids in the seed are fixed uuids, not
  generated, so the uuids printed in [[5-questionnaire-format#3. Serialization]] resolve against a running
  database (Decisions Log #35). Do not "fix" the seed to generate them. Sessions and responses generate
  ids normally.
- **Validate `option_ids` uniqueness in code.** The `response_shape` check covers cardinality, NULL
  elements and the `yes`/`no` domain, but not duplicates within the array. The submit validator walks
  `option_ids` against the pinned question version's options anyway — assert distinctness in that same
  walk and return `422`. This is the one invariant on this table that is *not* enforced below you.
- **Pick the right role.** Definition repositories use the `qp_definition` pool; execution
  repositories use `qp_execution`. Never reach across — execution code must not read an authoring
  table, and the grants will stop it at runtime if it tries. Execution reads versions from
  `definition.published_questionnaire_version`; it has no `SELECT` on the base `questionnaire_version`.
- **Take the lock first.** Three operations need a row lock as their *first* statement:

  | Operation | Lock |
  | --- | --- |
  | publish / create-draft / retire | `SELECT ... FROM definition.questionnaire WHERE id = $1 FOR UPDATE` |
  | create a question version | `SELECT ... FROM definition.question WHERE id = $1 FOR UPDATE` |
  | submit | `SELECT ... FROM execution.session WHERE id = $1 FOR UPDATE` |

  Publish additionally locks the version row before reading items, then runs `validateDraft`, then
  calls `definition.promote_draft`.
- **Publish only through `definition.promote_draft`.** `qp_definition` cannot `UPDATE` status, version,
  snapshot, `format_version`, `published_at` or the current-version pointer, so there is no other way.
  The function refuses anything but a draft (`QP001`), refuses a snapshot that does not name this
  questionnaire, its next version and exactly the draft's item rows (`22023`), writes
  `version_question_index` before flipping status, and does the compare-and-swap promote itself. Validation
  is not in the function: always run `validateDraft` first. **Neither is the audit row:** write it with the
  audit repository function straight after, in the same transaction. Calling `promote_draft` without
  that publishes unaudited — an accepted limitation (Decisions Log #51), not a pattern to use.
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
- **The seed publishes through the real service.** The `INSERT` trigger and the column grants make
  inserting or hand-promoting a published row impossible, and that is intentional — the seed is the first
  integration test of the publish path.
- **Never edit, regenerate or squash a committed migration.** `0000_schema.sql` carries hand edits
  drizzle-kit cannot see; see the backend README's "Hand-edited migrations" section and its guard tests.

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

Connect: `psql "$DATABASE_URL_DEFINITION"`, or `docker compose exec db psql -U questionnaire -d questionnaire_platform`.

Tests run against a Testcontainers Postgres with a template database per Vitest worker; `TEST_DATABASE_URL`
is the escape hatch for pointing at an existing instance, and takes an admin URL (Decisions Log #47). See [[8-testing]].

## Roles and connection strings

Five identities, three connection strings (Decisions Log #39,
[[9-database-schema#11.3 Roles are not schema, and must not be in a committed migration]]), wired in
`docker-compose.yml` and `.env.example`: the bootstrap superuser (`POSTGRES_USER`) runs `db/init/01-roles.sh`
once; `qp_owner` runs migrations (`DATABASE_URL_OWNER`); the backend's two pools use
`DATABASE_URL_DEFINITION` and `DATABASE_URL_EXECUTION`, and the seed the first of them; `audit_owner` has no
login. There is no unsuffixed `DATABASE_URL`.

The four things that fail quietly if this is ever rewired:

1. **`qp_owner` must not be `POSTGRES_USER`.** `initdb` makes that role a cluster superuser. Keep a
   separate bootstrap superuser and `ALTER DATABASE ... OWNER TO qp_owner`.
2. **`ALTER DEFAULT PRIVILEGES FOR ROLE qp_owner` only covers objects `qp_owner` created.** Run
   migrations as anything else and every future table silently gets no grant.
3. **The init script must be `.sh`, not `.sql`** — `psql -f` does not interpolate, so a `.sql` file
   would need literal passwords. Role passwords must be URL-safe; the script refuses anything else
   (Decisions Log #50).
4. **It runs once, on an empty data directory.** Each `CREATE ROLE` is guarded so it can be re-run by
   hand; `docker compose down -v` is the only reset.

Tests run the same `db/init/01-roles.sh` via `execInContainer`. Do not write a second one.

**Do not "simplify" `SET search_path = audit, pg_temp`** on `audit.record`, or
`SET search_path = definition, pg_temp` on `promote_draft`. A `SECURITY DEFINER` function without a pinned
search path is a privilege-escalation vector; `pg_temp` goes last and the body stays schema-qualified.

## Where to read more

- [[9-database-schema]] — full DDL, triggers, grants, concurrency, indexing, alternatives
- [[2-design-doc#12. Database]] §12.1–12.2 — the summary and the normalized/snapshot split
- [[5-questionnaire-format#6. Versioning mechanics]] — what a response pins to and why
- [[7-application-boundary#3.2 Database grants]] — the role barrier
- [[6-observability#5. Audit trail]] — why audit is a table and not a log line
- [[3-scaling]] — partitioning, archival and the ordered levers
