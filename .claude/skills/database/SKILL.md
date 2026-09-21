---
name: database
description: Schema, invariants, roles, migration mechanics and Postgres traps for the questionnaire platform's database. Use whenever writing or changing schema, migrations, repository code, seeds, or database tests, or when reasoning about transactions, locking, partitioning or grants.
---

# Database — working rules

Full reasoning lives in [[9-database-schema]]; [[2-design-doc#12. Database]] carries the
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

The one extension is `pg_stat_statements`, preloaded by the `db` service and created by `db/init/01-roles.sh`; nothing in the
schema depends on it. **Postgres 16 has no `uuidv7()`** — ids are generated in the
application.

## The schema at a glance

Three schemas hold data, and a fourth, `monitor`, holds functions only. The split is not cosmetic: it is what makes the definition/execution grant barrier
structural instead of a per-table list someone has to remember to extend.

- **`definition`** — `question`, `question_version`, `question_version_option`, `questionnaire`,
  `questionnaire_version`, `questionnaire_item`, `version_question_index`
- **`execution`** — `session`, `response`
- **`audit`** — `event`
- **`monitor`** — `SECURITY DEFINER` functions that return aggregates for telemetry (`0021`); no table or view

Roles: `qp_owner` owns everything and runs migrations. `qp_definition`, `qp_execution` and `qp_reporting`
are the three application roles (three pools, three connection strings; the owner's makes four).
`qp_reporting` is read-only, apart from `audit.record` (for `view_response` only), and exists for the admin responses browser (Decisions Log #89).
`audit_owner` owns the audit schema and the function that writes to it. `qp_monitor` is the telemetry identity: a member of
`pg_monitor`, `EXECUTE` on the `monitor.*` functions, no privilege of any kind on a table in `definition`, `execution` or `audit`. It has no backend
connection string; the Collector connects as it.

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
   else. `qp_reporting` is the only other role that can read `execution.*` — `SELECT` on `session` and
   `response`, no write privilege on any relation, and no other write than `audit.record`, which accepts only `view_response` from it — and `qp_definition` has no grant on either. A response's
   `questionnaire_version_id` must match its session's pin (composite FK). **The only `DELETE` any
   application role holds is `qp_definition` on `questionnaire_item`**, bounded to drafts by the item guard.
   Do not grant another.
6. **`audit.event` is append-only and unreachable directly.** Writes go through
   `audit.record(...)`, a `SECURITY DEFINER` function. `qp_definition` has no privilege on the table —
   not even `SELECT`. `qp_definition` and `qp_reporting` are the only roles with `EXECUTE` on the
   function. The function refuses any action but `view_response` when `session_user` is `qp_reporting` (`0022`), and the reporting repository's one audit function records `view_response` alone (`0020`).
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
  repositories use `qp_execution`; reporting repositories (`db/reporting`) use `qp_reporting`. Never reach across — execution code must not read an authoring
  table, and the grants will stop it at runtime if it tries. Execution reads versions from
  `definition.published_questionnaire_version`; it has no `SELECT` on the base `questionnaire_version`.
  **`modules/reporting` holds the `qp_reporting` pool and no other.** Its whole surface is `SELECT` on `session`,
  `response`, the same published view, and the `id` column of `definition.questionnaire`, plus `EXECUTE` on `audit.record`
  for `view_response` (`0020`; `0022` enforces the action inside the function). If it needs another
  read, add a `SELECT` grant in a migration (`0010`, `0018` are the shape); never hand it `qp_execution`'s pool,
  which can write. A test enumerates the role's privileges, so a widening fails loudly.
- **Read `response` with its partition key.** Filter on `created_at` as well as `session_id` (a submitted session's
  `submitted_at` *is* its rows' `created_at`), or the read scans all 36 partitions. Keyset pages compare the row,
  `(col, id) < ($1, $2)`, never `a < $1 OR (a = $1 AND b < $2)`: only the row form is an index seek.
- **The sessions list sorts by `started_at` or `submitted_at`, either way (Decisions Log #90).** The column and direction
  come from a closed enum mapped to fixed columns and fixed SQL fragments in `db/reporting/keyset.ts`; nothing a client
  sends is interpolated. `started_at` is `NOT NULL`, so `session_by_questionnaire` serves both directions. `submitted_at` is
  `NULL` for an in-progress session and **`NULL`s sort last in both directions**. Row comparison is never true over a
  `NULL`, so the keyset is written out: the row form for the non-null run, then `IS NULL`, and `IS NULL AND id …` inside the
  tail, one statement per segment; a `status` filter drops the segment it makes impossible, so a filtered page is one statement and no transaction. **A btree scanned backward flips its `NULL` placement, so ascending-`NULLS LAST`
  and descending-`NULLS LAST` need two indexes** (`session_by_questionnaire_submitted_asc` / `_desc`, migration `0019`); an
  `ORDER BY` whose `NULLS` clause does not match an index is a `Sort` node, not a scan, even on a `NOT NULL` column. A change to
  the query or the indexes is checked by `_tests/db/reporting/sessions.test.ts`, which `EXPLAIN`s every sort, order and
  direction and, for the unfiltered shape, fails on a `Sort` node or a keyset that is not an `Index Cond`. **That is an
  unfiltered guarantee:** no index carries `status` or `version`, so under a filter the test holds `status=submitted`
  and the common `version` to the same index plan plus a `Filter`, holds `sort=submitted&status=in_progress` to the sorted
  index with `submitted_at IS NULL` in its `Index Cond` and no rows removed by the filter (the first page carries that
  predicate, which the `session_state` check makes redundant in result and decisive for the plan; without it the planner
  walks the whole submitted run once 1% of a questionnaire is in progress), bounds `sort=started&status=in_progress` by rows
  examined, and pins only the node types for a rare `version` (which reads the whole table), the one filtered shape still
  unbounded (Decisions Log #90). The test seeds deterministic ids and full statistics so its plans do not vary between runs. Cursors carry sort and order and are
  validated field by field; a mismatched or forged one reads as no cursor. **The cursor holds a millisecond `Date`, so
  write `started_at`, `submitted_at` and `last_activity_at` as millisecond `Date`s and never let the `DEFAULT now()`
  fill one for a row a list can show:** the schema does not enforce it and a microsecond value can be skipped or repeated
  across a page (known bug, [issue #120](https://github.com/kenziesimpson/questionnaire-platform/issues/120)).
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
- **Audit writes go through one repository function per side** that calls `audit.record(...)`, inside the same
  transaction as the change or read it records: `recordAudit` in `db/audit.ts` for the definition side, and
  `recordResponseView` in `db/reporting/audit.ts`, which can record `view_response` and nothing else, for the
  responses browser. Never inline an audit write at a call site. `getSessionDetail` writes its row in the
  transaction that reads the answers, so a failed audit write fails the read; `listSessions` writes none.

## Rules for migrations

- **Generate first, then hand-edit.** For `execution.response`, let `drizzle-kit generate` emit the
  `CREATE TABLE`, then edit that file to append `PARTITION BY RANGE (created_at)` and the partition
  `CREATE`s. Declaring a table only in a hand-written migration leaves it out of drizzle-kit's snapshot
  JSON, so the next `generate` re-emits it and `migrate` dies on "already exists".
- **`drizzle-kit generate --custom`** for triggers, functions and grants. drizzle-kit emits none of them.
- **Every new function gets `REVOKE EXECUTE ... FROM PUBLIC`.** Postgres grants `EXECUTE` to `PUBLIC` by
  default; a catalog test fails if any function in `definition`, `execution`, `audit` or `monitor` keeps it. Grant
  `EXECUTE` explicitly to the one role that needs it.
- **A `monitor` function returns an aggregate, and `qp_monitor` never gains a table grant.** Add a function in a migration
  (`SECURITY DEFINER`, owned by `qp_owner`, `SET search_path = pg_catalog, pg_temp`, everything schema-qualified), revoke `PUBLIC`, grant
  `qp_monitor`. `_tests/db/monitor.test.ts` lists the schema's functions, so a new one is a reviewed line in that test.
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
- **Inside a `SECURITY DEFINER` function, tell callers apart by `session_user`, never `current_user`.** `current_user` is the function
  owner there. `session_user` is the login role, and `SET ROLE` does not change it. `audit.record` refuses `qp_reporting` any action but
  `view_response`, and any summary but `{"sessionId": <uuid>}`, this way (`0022`). It is a name match: it fails open if the role is renamed, every other
  caller is unrestricted, and it needs one pool per role with no pooler forcing a server user. Compare with `=`: `pg_has_role(session_user, ..., 'MEMBER')` is
  true for a superuser for every role.
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
docker compose up -d roles         # Postgres with the roles provisioned, for running the backend on the host

npm run db:generate -w apps/backend   # drizzle-kit generate
npm run db:migrate  -w apps/backend
npm run db:seed     -w apps/backend

docker compose down -v             # drop the db-data volume; the only clean reset
```

Connect: `psql "$DATABASE_URL_DEFINITION"`, or `docker compose exec db psql -U questionnaire -d questionnaire_platform`.

Tests run against a Testcontainers Postgres with a template database per Vitest worker; `TEST_DATABASE_URL`
is the escape hatch for pointing at an existing instance, and takes an admin URL (Decisions Log #47). See [[8-testing]].

**A test may open as many connections as it needs; a test file may not accumulate them** (Decisions Log #77).
`testDatabase.connect(role)` is test-scoped — the harness closes its clients in `afterEach` — and harness pools are
capped below `pg`'s default of ten. Postgres allows 100 connections and Vitest runs `availableParallelism() - 1` files
at once, so anything holding a connection for a file's lifetime is multiplied by the worker count. Do not add a
long-lived client to the harness, and do not cache one across tests in a test file.

## Roles and connection strings

Seven identities, four connection strings (Decisions Log #39 and #89,
[[9-database-schema#11.3 Roles are not schema, and must not be in a committed migration]]), wired in
`docker-compose.yml` and `.env.example`: the bootstrap superuser (`POSTGRES_USER`) runs `db/init/01-roles.sh`
(at init, and from the `roles` service on every `up`); `qp_owner` runs migrations (`DATABASE_URL_OWNER`); the backend's three pools use
`DATABASE_URL_DEFINITION`, `DATABASE_URL_EXECUTION` and `DATABASE_URL_REPORTING`, and the seed the first of them; `audit_owner` has no
login; `qp_monitor` (`QP_MONITOR_PASSWORD`) connects only for the observability Collector. There is no unsuffixed `DATABASE_URL`.

The four things that fail quietly if this is ever rewired:

1. **`qp_owner` must not be `POSTGRES_USER`.** `initdb` makes that role a cluster superuser. Keep a
   separate bootstrap superuser and `ALTER DATABASE ... OWNER TO qp_owner`.
2. **`ALTER DEFAULT PRIVILEGES FOR ROLE qp_owner` only covers objects `qp_owner` created.** Run
   migrations as anything else and every future table silently gets no grant.
3. **The init script must be `.sh`, not `.sql`** — `psql -f` does not interpolate, so a `.sql` file
   would need literal passwords. Role passwords must be URL-safe; the script refuses anything else
   (Decisions Log #50).
4. **The entrypoint runs it once, on an empty data directory — so compose re-runs it.** The one-shot
   `roles` service applies the same script before `migrate` on every `up` (Decisions Log #60). Keep it
   re-runnable: guard every `CREATE ROLE` with `NOT EXISTS`, set passwords with an unconditional
   `ALTER ROLE ... PASSWORD`. A new role goes in the script; its grants go in a migration.

Tests run the same `db/init/01-roles.sh` via `execInContainer`. Do not write a second one.

**Do not "simplify" `SET search_path = audit, pg_temp`** on `audit.record`, or
`SET search_path = definition, pg_temp` on `promote_draft`. A `SECURITY DEFINER` function without a pinned
search path is a privilege-escalation vector; `pg_temp` goes last and the body stays schema-qualified.

## Where to read more

- [[9-database-schema]] — full DDL, triggers, grants, concurrency, indexing, alternatives
- [[2-design-doc#12. Database]] — the summary and the normalized/snapshot split
- [[5-questionnaire-format#6. Versioning mechanics]] — what a response pins to and why
- [[7-application-boundary#3.2 Database grants]] — the role barrier
- [[6-observability#5. Audit trail]] — why audit is a table and not a log line
- [[3-scaling]] — partitioning, archival and the ordered levers
