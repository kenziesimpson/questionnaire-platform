# Dynamic Questionnaire Platform — Design Doc

> Status: **scaffold** — sections are filled in as decisions land. Prompts in *italics* are the questions each section should answer; delete them once answered.
> Related: [[1-ideation]], `.claude/skills/questionnaire-assignment/SKILL.md` (outside the vault index), assignment brief (Claude Project).

## 1. Overview

The dynamic questionnaire platform enables the creation of reusable, versioned questions and questionnaires with branching and lifecycle management, as well as tracking responses.

There are two halves of the system; admin and respondent. The admin view is responsible for creating, editing, and managing the questions and questionnaires, and the respondent view is responsible for answering the questionnaires. Each aspect has its own service. They are both behind an nginx proxy, and are separate to unlock untethered scalability.

Once a user has started responding, they are able to resume from the same browser for the next 7 days, and the version of the questionnaire that they're responding to becomes pinned. Even if the phrasing of questions or answers is changed, the questions/answers themselves are associated between versions, allowing for the interpretability of questions answered across versions.

## 2. Goals

- **A working end-to-end loop.** An admin can create, edit, publish and retire questionnaires built from reusable questions. A respondent can complete a published questionnaire, follow the correct branch, and resume an interrupted session.
- **Published versions never change.** Once published, a questionnaire version and the question versions it pins are immutable. This is enforced by the database, not just the application ([[#6. Versioning & Immutability]]).
- **Responses stay meaningful across versions.** Every response is tied to the version it was collected under. Questions and options keep stable ids, so answers can be compared across versions even when wording changes.
- **Invalid states can't be built.** Rules may only reference earlier questions, so cycles and dead ends are impossible rather than detected. The same approach applies to drafts reaching respondents and to malformed answers ([[#7. Branching Rules]], [[#12. Database]]).
- **Authoring and answering are separate.** Definition and execution are separate modules with separate database roles. Only the published snapshot crosses between them ([[#9. API / Service Boundary]]).
- **Versioning and branching are proven by tests.** This includes the required medical-condition demo and its second version ([[#15. Testing]]).
- **Every tradeoff is written down.** Decisions carry their rejected alternatives ([[12-decisions-log]]). Anything not built has a stated reason and a production path ([[#4. Out of Scope]], [[#18. Future Work]]).

## 3. Constraints

- **Limited time.** The original deadline was one week, so a complete end-to-end slice came first. An extension later made room for scale work ([[#16. Scale & Growth]]).
- **Runs with one command.** `docker compose up` builds, migrates, seeds and serves the whole stack, and `npm test` runs every test suite. Any design that needs a second step to run was rejected ([[#13. Deployment]]).
- **Published versions are immutable.** This is a hard requirement from the assignment brief. Anything that edits a published questionnaire, or a question it pins, is out ([[#6. Versioning & Immutability]]).
- **Nothing is deleted.** Questionnaires retire, questions are archived, question versions are only ever added, and snapshots and responses never change. Any new entity follows the same rule. The one exception is erasure on request under GDPR or HIPAA, which would be a separate, audited capability and is not built ([[#18. Future Work]]). Decisions Log #15.
- **Prefer the simple, out-of-the-box option.** When two designs give the same guarantee, choose the one with less custom machinery. This never weakens an invariant the database is meant to enforce: in that case, the custom object stays and is documented and tested. Decisions Log #33.

## 4. Out of Scope

| Deferred capability | Why deferred | Production approach |
| --- | --- | --- |
| Authentication / authorization | Not required to demonstrate the core workflow; would consume time better spent on versioning and branching. | Define the access *model* and data barriers now (admin vs. respondent, session ownership) so auth can be slotted in. Assume an upstream identity provider (OIDC) and enforce roles in a Fastify hook. |

## 5. Questionnaire Format

> **Detail: [[5-questionnaire-format]].** Summary only here.

A questionnaire version is a **flat, ordered list of items**. Each item places one question version at an index and carries the questionnaire-specific concerns — `required` and an optional `visibleWhen` predicate. Reusable question content carries neither: where a question sits, whether it is required there, and what makes it appear are properties of the placement, not of the question.

There are no edges between questions. Order is the list index, and the next question is the first unanswered item whose predicate is true, so convergence after a branch is not a property to prove — it is the only thing a list can do.

Five response types — `text`, `single_choice`, `multiple_choice`, `number`, `date`. There is no `yes_no` type: a yes/no question is a `single_choice` with two options, created by an editor template seeding the reserved ids `yes` / `no` with editable labels, so the same question can be phrased True / False without becoming a different kind of thing. Two identity guarantees carry the versioning story: **option ids are stable across question versions**, and **number answers are stored with their unit**. Both exist so that revising a question cannot retroactively change what an earlier response meant.

A published version serializes to a single JSONB document carrying its own `formatVersion` ([[#Authoring vs published]]).

See Decisions Log #6, #11, #12, #36 (which supersedes #10).

## 6. Versioning & Immutability

> **Detail: [[5-questionnaire-format#6. Versioning mechanics]].**
### Questionnaires
- At most one draft at a time, enforced by a partial unique index.
- Publishing turns the draft row into version *N* in place.
- The next draft starts as an explicit copy of the latest published version.
- A published version is never edited.
### Questions
- Questions are append-only and have no draft state: every save writes a new, immutable `question_version` row, so saving *is* publishing.
- A stable `questionId` keeps a question's identity across revisions.
- An item pins the `questionVersion` it had when it was added and keeps it, so a draft never changes under its author.
- Questions are archived, never deleted ([[#3. Constraints]]).
### Responses
- Each response stores:
  - `questionId`, which is what you aggregate on.
  - `questionVersion`, which is what you render with.
  - The questionnaire version.
  - The option ids or the value.
- Storing the version means a response can be read without loading the definition it was collected under.
- Prompt text is not copied onto responses. The snapshot holds it.
### Enforcement
- **Database trigger.** It rejects `UPDATE` and `DELETE` on published rows. This is the actual guarantee.
- **API `409`.** Gives authors a usable error.
- **Direct-to-database test.** It keeps the guarantee from quietly breaking behind a service-layer refactor.
- **Snapshots are never rewritten.** Each carries a `formatVersion` and is upgraded in memory when read. The stored bytes are the record of what the respondent actually saw.

See Decisions Log #7, #8, #13, #14.

## 7. Branching Rules

> **Detail: [[5-questionnaire-format#4. Branching rules]] and [[5-questionnaire-format#5. Publish-time validation]].**
### Predicates
- Each item can have a `visibleWhen` predicate. It is one level of `all` / `any` over a list of conditions.
- Conditions are typed per response type, so an invalid comparison (such as a date against a number) can't be written.
- A condition names an `itemId` (a placement), not a reusable question.
- A condition can only reference earlier items.
- A question appears at most once per version, so `questionId` stays a sound key for aggregating (Decisions Log #41).
### Evaluation
- The next question is the first unanswered item whose predicate is true. The questionnaire is complete when the list runs out.
- A condition on a question that wasn't shown is `false` for every operator, including negative ones.
- The client (for rendering) and the server (on submit, where it has the final say) use the same evaluator from the shared package.
### Cycles and deadlock
- These aren't detected, because they can't be built.
- References only point backwards, so a cycle is impossible.
- The end of the list is always reachable, so a respondent can't get stuck.
### Publish-time validation
- Rejects forward references.
- Checks that each predicate can be satisfied, exactly, by intersecting the answer ranges its conditions allow. A single level of `all` / `any` keeps this cheap.
- Checks that every referenced item and option exists.

See Decisions Log #6, #9.

## 8. Sessions & Responses

> **Detail: [[7-application-boundary#5. Execution API]].**
### Lifecycle
- A session goes from `in_progress` to `submitted`. There are no other states.
- Abandonment isn't a state. It's a session that never submitted, and analytics picks it up from the session record ([[6-observability#4. Domain events]]).
- Resume works because the browser holds the partial answers and the server holds the version pin.
### No checkpoint endpoint
- Respondents are anonymous, so the session id is kept in the same browser storage as the answers. Anything that loses the answers also loses the id needed to fetch a server copy.
- Resuming on another device needs an identity, not a write path.
- Client domain events already record where a session stopped.
- This is deferred, not rejected, and adding it later won't break anything. See [[7-application-boundary#9.7 A debounced checkpoint endpoint]].
### Republishing mid-session
- A session pins its version when it starts, and every later read returns that version.
- The execution API has no route that returns the current version of a questionnaire ([[7-application-boundary#5.2 There is no unpinned definition read]]).
- So sessions already running never see a new publish, and sessions started after it do. No coordination or migration is needed.
### Submit
- Submitting is the only write, and the server's answer is final.
- The server re-evaluates the path against the pinned definition. It accepts the submission only if:
  - every visible required item is answered
  - every answer belongs to a visible item
  - every value meets its question version's constraints
  - `closes_at` hasn't passed
- The whole submission is saved in one transaction or rejected.
### Idempotency
- The session itself is the idempotency key, so there's no separate key table.
- Submit locks the session row. If the session was already submitted, a digest of the answers decides the result:
  - Same answers: the original receipt is replayed, so a network retry is safe.
  - Different answers: `409`, rather than silently overwriting someone's medical history.
- This also catches the same form submitted from two browser tabs, which a key supplied by the client would miss.
### Retirement
- Retirement belongs to the questionnaire, not a version. Published versions stay readable so old responses can still be rendered.
- One nullable `closes_at` covers every case:

| Lifecycle | `closes_at` |
| --- | --- |
| Ongoing | `NULL` |
| Scheduled close | future date |
| Retired now | `now()` |

- Past `closes_at`, starting and submitting are both rejected, and the respondent sees a "responses closed" page.
- This is a **hard cutoff**: a session started before the close but submitted after it is also rejected, so the respondent loses their work.
- A per-questionnaire `cutoffMode: 'hard' | 'soft'` is the likely fix. It's deferred ([[#17. Open Questions]] §1).

See Decisions Log #15, #18, #19, #25, #29, #37.

## 9. API / Service Boundary

> **Detail: [[7-application-boundary]].**
### The boundary
- The two sides don't share code, models or tables. The only thing passed between them is the immutable `PublishedDefinition` snapshot ([[5-questionnaire-format#3. Serialization]]).
- The definition side produces snapshots, and the execution side consumes them.
- The execution side never reads a draft, never looks up a `questionId` in the question bank, and never joins to an authoring table.
### Three representations

| Representation | Side | Shape |
| --- | --- | --- |
| `QuestionnaireDraft` | Definition only | Normalized, mutable, may be invalid |
| `PublishedDefinition` | Crosses the boundary | Immutable, self-contained |
| `Session` + `Response` | Execution only | Pinned to a version |
### Enforcement
- **Modules.** Fastify plugins are encapsulated and can't import each other. An ESLint zone rule enforces this.
- **Types.** The wire types in `@qp/shared` give the execution side no way to name a draft.
- **Database roles.**
  - `qp_execution` reads only published versions, through a view. It has no access to drafts or the question bank.
  - `qp_definition` has no access to `response`, so the authoring API can't be used to reach answers.
### Routes
- `/api/definition/*` covers the question bank, drafts, publish, retire, version history and snapshot inspection.
- `/api/run/*` has three routes: start a session, resume it, and submit it. The client evaluates branching itself, so there's no next-question call.
- The execution API has no unpinned definition read ([[#8. Sessions & Responses]]). Admin preview and version history are on the definition API.
### Conventions
- Every non-2xx response is an RFC 9457 `problem+json` body. Its `type` comes from a fixed list in `@qp/shared`.
- Status codes:
  - `400`: schema failure only. It always means a client bug, so it's worth alerting on.
  - `409`: conflicts with current state.
  - `422`: well-formed but invalid for the domain.
- Each route has one TypeBox schema, and its TypeScript type is inferred from it. The frontend imports the same types.
- Error bodies never echo a submitted answer. They name the item and the rule it broke.
### Access model
- Auth is out of scope ([[#4. Out of Scope]]), but the model is defined.
- **Authors:** one plugin-wide hook covers `/api/definition/*`, so new routes are protected by default.
- **Respondents:** anonymous. The session id is a random value that acts as the credential, so it's kept out of URLs and `Referer` headers.
**The boundary is an artifact, not a route prefix.** Exactly one object crosses it, the immutable `PublishedDefinition` snapshot ([[5-questionnaire-format#3. Serialization]]), and the dependency runs one way: the definition side produces snapshots, the execution side consumes them and nothing else. Execution never reads a draft, never resolves a `questionId` against the question bank, never joins to an authoring table. That is affordable only because the snapshot is already self-contained by construction ([[#12. Database]] §12.1) — the storage decision was made for read performance, and a clean cut between the halves is the property being cashed in here.

**Three representations, each on one side of the line.** `QuestionnaireDraft` (definition only — normalized, mutable, may be invalid), **`PublishedDefinition`** (crosses; immutable, self-contained), `Session` + `Response` (execution only, pinned to a version). Execution code accepts only the middle one.

**Enforced in three places, none of which is the URL.** Encapsulated Fastify plugins with no cross-imports, an ESLint zone rule reusing the pattern already chosen for the telemetry boundary; wire types in `@qp/shared` that give execution no way to *name* a draft; and two database roles for these two halves specifically, where `qp_execution` has no grant on any authoring table and `qp_definition` has **no grant on `response`** — the authoring surface is not a back door into answer data. The barrier is therefore something Postgres enforces rather than something the service layer promises, and "are the halves actually separate?" has a mechanical answer instead of an architectural claim. (A third role, `qp_reporting`, exists alongside these two for an unrelated admin-only surface — [[7-application-boundary#3.2 Database grants]], Decisions Log #89 — and does not change this boundary.)

**Two route groups.** `/api/definition/*` owns the question bank, drafts, publish, retire, version history and snapshot inspection. `/api/run/*` owns sessions and submission, and is deliberately three routes — the client holds the whole definition and evaluates branching locally, so there is no next-question round trip to design. **The execution API has no unpinned definition read:** fetching a definition is inseparable from starting a session, which is what makes version drift mid-session unrepresentable rather than handled ([[#8. Sessions & Responses]]). Admin preview and version history live on the definition API instead, where the audience, the addressing and the access model are all different.

**Conventions.** RFC 9457 `application/problem+json` on every non-2xx, with `type` slugs from a closed union in `@qp/shared` so they are exhaustive on the client and cannot be invented at a call site. `400` is schema failure only — so a `400` is always a client bug and never a user mistake, which makes it a usable alerting signal; `409` means the request conflicts with current state; `422` means well-formed but domain-invalid. Validation is one TypeBox schema per route with the TypeScript type inferred from it, so a route's declared contract and its handler cannot disagree, and the frontend imports the same types. **Error bodies never echo a submitted answer** — a `422` names the item and the rule it broke, never the value — extending the telemetry redaction rule ([[#14. Observability]]) to the one other place it is easy to lose.

**Access model** (auth itself is out of scope, [[#4. Out of Scope]]): authors authenticate against `/api/definition/*` through a single plugin-wide hook, so a new definition route is protected by default and forgetting is not one of the available mistakes; respondents are anonymous and the session id is a bearer capability, which makes it a cryptographically random id, kept out of `Referer` headers and query strings and never rendered to anyone else.

**Topology:** two encapsulated plugins in one process now, two services later — chiefly for security, since the authoring API then need not be routable from the public internet at all, and a vulnerability reached through the unauthenticated respondent surface lands in a process that cannot touch authoring tables. Because the boundary is enforced by module graph, types and grants rather than by a network hop, that split is a deployment change rather than a rewrite; [[7-application-boundary#8.3 What we do now to keep the split cheap]] lists what the prototype does to keep it that way.

See Decisions Log #17, #18, #19, #20, #21.

## 10. Frontend

> **Detail: [[10-frontend]].**
### Structure
- React + TypeScript via Vite, built as two apps: `apps/respondent` and `apps/admin`.
- `packages/ui` is shared by both. It holds the component primitives and the questionnaire renderer.
- The two apps can import from each other only through that package, and the respondent bundle contains no admin code.
- Deploying the two apps separately later is a deployment change ([[3-scaling#6. Future improvement: split the frontends]]).
### Respondent
- One URL, `/q/:questionnaireId`. A state machine drives it through starting, form, submitted, closed and not-found.
- All visible items render on one page. Each answer re-evaluates every predicate, so items appear and disappear in place.
- Partial answers are saved in `localStorage`, including answers to hidden items. At submit, they're filtered to the visible set with the same engine the server uses.
- On landing, the app resumes a stored session if there is one before starting a new one.
- After a successful submit, the app clears the answers but keeps the session id, so reopening the link shows the receipt.
### Admin
- There are five screens: questionnaire list, draft editor, question bank, version history and preview.
- The question bank has its own screen so it's clear that questions are reused across questionnaires.
- Questions can also be created and edited inside the draft editor. Editing there re-pins that item to the new version.
- The predicate editor is a flat list of condition rows. It offers only earlier questions and only operators that are valid for the question's type.
- The question editor's controls do the same for its cross-field constraint rules. For example, a max can't be set below its min.
- A question's response type is locked after its first save, in both the dialog and the server.
### Authoring concurrency
- Add-item requests carry the `questionVersion` the author saw. The server doesn't resolve "current".
- Two authors editing one question at the same time is allowed. Questions are append-only, so no version is lost, and a lost edit can't reach a snapshot or a response.
### Accessibility
- Accessibility is designed in from the start, because the domain is medical.
- Radix handles focus management in dialogs and gives controls the right semantics.
- dnd-kit provides keyboard reordering and announcements.
- An `aria-live` region announces questions as they appear.
- What's covered and what's excluded is in [[10-frontend#7. Accessibility]].
### Libraries
- The respondent app stays light. The admin app uses libraries where it caches server data or does conventional editing.

| | Admin | Respondent |
| --- | --- | --- |
| Routing | TanStack Router (code-based) | N/A |
| Server data | TanStack Query | plain `fetch` |
| Forms | none | TanStack Form |
| Reordering | dnd-kit | N/A |
| Styling | Tailwind v4, shadcn/Radix | Tailwind v4, shadcn/Radix |
### Deployment
- One nginx container serves both apps: respondent at `/`, admin at `/admin/`.
- It reverse-proxies `/api` to the backend, standing in for a production ingress ([[#13. Deployment]]).
- Static assets can move to a CDN later without code changes.

See Decisions Log #1, #27, #28, #29, #30, #31, #32, #58, #61, #70–#73.

## 11. Backend
### Stack
- Node LTS, Fastify and TypeScript.
- Fastify has request validation built in (TypeBox), a strong plugin ecosystem, and `@fastify/otel` for tracing.
- API types are shared with the frontend through `@qp/shared`.
### Modules
- There are two encapsulated Fastify plugins:
  - `modules/definition`: question bank, drafts, publish, retire and version history.
  - `modules/execution`: sessions and submit.
- Each has its own routes, schemas and repositories. Neither imports the other.
- Each has its own connection pool, bound to its own database role.
- `@qp/shared` holds the wire types and the one rule engine both sides use.
- It's one process today and can become two services later ([[#9. API / Service Boundary]], [[7-application-boundary#3. Enforcing the boundary below the type system]]).
### Transactions and concurrency
- Publish and submit each run in one transaction.
- Draft edits carry an `If-Match` ETag. A stale edit gets `409` instead of overwriting another tab's changes.
- Respondents only touch their own session rows.
- Submit locks its session row (`SELECT ... FOR UPDATE`), so duplicate submits run one after the other ([[7-application-boundary#5.4 Submit: authority, validation, idempotency]]).

See Decisions Log #2, #3, #21, #43.

## 12. Database

> **Detail: [[9-database-schema]].** Summary only here.
### Stack
- PostgreSQL, accessed through Drizzle ORM and the `pg` driver. `drizzle-kit` generates SQL migrations, which are committed.
- Postgres gives us transactions for publish and submit, JSONB for snapshots, and native partitioning for response history.
- Drizzle keeps the schema in TypeScript and stays close enough to SQL for partitioning and `SELECT ... FOR UPDATE`.
- Each backend pool is an in-process `pg` pool. In production, PgBouncer in transaction mode goes in front.
### Schemas
| Schema | Holds |
| --- | --- |
| `definition` | Question bank, questionnaires and their versions, draft items, `version_question_index` |
| `execution` | `session`, `response` |
| `audit` | One append-only `event` table |

- Grants are set per schema, so they follow the definition/execution boundary.
### Authoring vs published
- Authoring uses normalized tables, where each question, option and placed item is its own row, linked by foreign keys. The database rejects broken references, edits touch only the rows they change, and "which questionnaires use this question?" is a simple query.
- Each published version is one immutable JSONB snapshot, written in the publish transaction.
- A respondent needs the whole definition once per session. One row serves that. Being immutable, it can also be cached forever.
- Question content is duplicated on purpose, in the bank and in every snapshot that used it. That way a later edit to a question can't change a published version.
- `version_question_index` answers "which published versions contain question X?" It's derived from the snapshots and can be rebuilt.
### Invariants in the database
| Invariant | How |
| --- | --- |
| A draft can't be referenced | `version` is null on drafts, so composite foreign keys match only published rows. A session can't pin a draft. |
| Published versions can't change | Triggers reject `UPDATE` and `DELETE` on published rows, and `INSERT` of a row that's already published. Draft items are checked against their parent's status with a locking read. |
| Question versions are append-only | Triggers reject every `UPDATE` and `DELETE`. |
| An invalid answer can't be stored | `response` has a typed column per response type, under one check constraint. |
| Responses can't change | `qp_execution` has only `SELECT, INSERT` on `response`. A response's version must match its session's pinned version. |
### Roles and grants
| Role | Can | Can't |
| --- | --- | --- |
| `qp_definition` | Read and write `definition`. Delete draft items. Write audit rows through `audit.record`. | Touch `execution` at all, or read `audit.event` |
| `qp_execution` | Read published versions through a view. Write `session`. Insert into `response`. | Read drafts, or update or delete responses |
| `qp_owner` | Own every object and run migrations | Access `audit` |
| `audit_owner` | Own `audit` | Log in |

- Roles are created by `db/init/01-roles.sh`, never by a migration.
### Audit
- Authoring actions write to `audit.event` in the same transaction as the change.
- The only way in is `audit.record`, a `SECURITY DEFINER` function, so the log is append-only by grant.
- Moving it to its own database later would go through a transactional outbox. That isn't built.
### Partitioning and indexes
- `response` is range-partitioned monthly on `created_at`.
- `created_at` is set to the session's `submitted_at`, so all of a session's rows land in one partition.
- There's no default partition, so old partitions can be detached without locking the table.
- Every index serves a named query or invariant. There's no GIN index on `snapshot`, because it's always read whole.
### Concurrency
| Row lock | Taken by | Prevents |
| --- | --- | --- |
| Questionnaire | Publish, create draft, retire | A new draft copied from a stale version, which silently reverts a publish |
| Question | Saving a question | Two saves computing the same version number |
| Session | Submit | Duplicate submits racing each other |

See Decisions Log #4, #7, #23, #24, #39, #45, #46, #48, #49, #78.

## 13. Deployment
### Compose services
| Service | What it does | Starts after |
| --- | --- | --- |
| `db` | `postgres:16-alpine`, with a named volume | — |
| `roles` | One-shot. Runs `db/init/01-roles.sh` to create or update the database roles | `db` is healthy |
| `migrate` | One-shot. Runs migrations, creates the coming months' `response` partitions and seeds the demo questionnaire | `roles` exits 0 |
| `backend` | Node LTS and Fastify. Stateless | `migrate` exits 0 |
| `frontend` | nginx serving both Vite builds: respondent at `/`, admin at `/admin/` | `backend` |
### Running it
- `docker compose up` builds, migrates, seeds and serves the whole stack.
- Compose has defaults for every setting, so it boots without a `.env`. The defaults are obviously not secrets. A real deployment gets its credentials from a secret store.
- Postgres listens on `127.0.0.1` only. `psql` works from the host, but the database isn't reachable from the network.
### Configuration
- Configuration is environment variables only, with a committed `.env.example`. No secrets go in images.
- There are three connection strings:
  - `DATABASE_URL_OWNER` for `migrate`
  - `DATABASE_URL_DEFINITION` for the backend's definition pool
  - `DATABASE_URL_EXECUTION` for the backend's execution pool
- There's no plain `DATABASE_URL`, so code that reads it fails instead of silently picking a role.
- Only the `roles` service creates roles, never a migration.
### Migrations
- Migrations run in their own one-shot service, not at backend startup. If they ran at startup, two backend replicas would race to migrate.
- The backend doesn't start until `migrate` succeeds, so it never serves against an old schema.
### Reverse proxy
- nginx proxies `/api` to the backend, so the browser sees a single origin. That means no CORS and no API URL built into the bundle.
- In production, an ingress or load balancer does the routing, and a CDN serves the static files.
### Dev loop
- `docker compose up` automatically merges in `docker-compose.override.yml`. The override mounts the source and swaps in dev servers:
  - Vite for the respondent app on port 5173
  - Vite for the admin app on port 5174
  - `tsx watch` for the backend
- `docker compose -f docker-compose.yml up` skips the override and runs the production images.
- Vite polls for file changes, because macOS bind mounts can miss change events. If a backend change is missed, restart the `backend` container.
### Kubernetes
The same split, with these changes:

| Compose | Kubernetes |
| --- | --- |
| nginx routes `/api` and `/` | An ingress controller does the routing |
| nginx serves the built apps | A CDN in front of object storage |
| `backend` | A Deployment, scaled by an HPA |
| `migrate` | A Job that must succeed before the new backend rolls out |
| `db` | Managed Postgres |
| Environment variables | ConfigMaps and Secrets, with the same three connection strings |

- Still open: the image registry and the rollout strategy (rolling or blue/green). Whichever we pick must keep the rule that no backend runs against a schema older than it expects.
- Also open: how roles get created on managed Postgres ([[#17. Open Questions]] §8).

See Decisions Log #5, #39, #60.

## 14. Observability

> **Detail: [[6-observability]].** Summary only here.

**Decision:** OpenTelemetry end to end; respondent answer values structurally excluded from every signal. See Decisions Log #16 and #92–#101; build status by pull request in [[4-implementation-plan#Wave 3b]].

### Instrumentation
- OpenTelemetry spans, metrics, and logs; `@fastify/otel` on the backend.
- Browser propagates W3C `traceparent` to backend, recorded as `client.trace_id` but never a parent (each request is a trace root).
- Manual spans (`questionnaire.publish`, `session.submit`, `rule.evaluate`, `reporting.*`, `telemetry.ingest`) from a closed list; unknown names are dropped and counted.
- Domain events logged and metered together so they cannot drift; traces join logs via `trace_id`.

### Answer scrubbing
- Answer values are `Sensitive<T>`. Log and span context is a closed type registry; a scrub runs at call sites, at log output and at export.
- Span names and logger modules are closed lists; the Collector redacts and re-scrubs as a last pass.
- A sentinel leak test plants answer values everywhere they could reach code and asserts they reach no log, span, metric or exported record across five paths (submit, definition, ingest, response detail). Runs as `npm run test:leak-test`; every PR touching answers extends it.
- Detail: [[6-observability#3. Respondent answers must never enter telemetry]].

### Health and errors
- Every non-2xx is RFC 9457 `problem+json`; a 500 carries its `trace_id` as the `detail`.
- `/health/live` (process up, no database touch) and `/health/ready` (both pools respond to `SELECT 1`) for Kubernetes liveness and readiness.

### Observability infrastructure
- `packages/telemetry` is the only importer of `pino` and `@opentelemetry/*`, enforced by ESLint.
- Logs are structured JSON on stdout.
- Export is off by default; setting `OTEL_EXPORTER_OTLP_ENDPOINT` sends traces, metrics and logs over OTLP/HTTP through a Collector.
- The `observability` Compose profile (opt-in) brings up the Collector, Grafana + LGTM, five dashboards, nine alert rules, and nginx access logs.

### Client telemetry
- `@qp/telemetry/browser` in both apps: bounded queue posted to `POST /api/telemetry`, flushed with `sendBeacon`.
- Error capture records class name and stack frames, never the message.
- Hand-built `traceparent` carries one page trace id, recorded as `client.trace_id` backend-side.
- Two domain events only the browser can see: `session.abandoned` and `page.loaded`.
- Browser records spans and logs, exports nothing.

### Database and audit
- `pg` spans and pool gauges; trace id in each SQL comment for correlation.
- Audit trail lives in `audit` schema, reachable only through append-only functions with `SECURITY DEFINER`, enforced by grants ([[#12. Database]]).
- Audit rows share transactions with the write they record (publish, retire); immutability is Postgres's problem.
- Validation and redaction ensure a bound value does not reach Postgres's own log (its `STATEMENT:` line is a known leak point).

**Verification.** The leak test covers five paths; trace continuity from `traceparent` to spans, logs and SQL comments; validation bounds (integers at `integer` max, dates year 1–9999, no nulls). V1 closed the two values validation admitted. Not built: the pre-commit hook and agent PR review of the enforcement ladder.

## 15. Testing

> **Detail: [[8-testing]].** Summary only here.

**Decision:** four layers, weighted toward the fast ones, with a real Postgres wherever the invariant being tested is a database object. See Decisions Log #22 and #77.

The suite exists to make the design's claims falsifiable, not to reach a coverage number. Three invariants are load-bearing and every layer defends one: a published version is immutable, a response's meaning is pinned to the version it was collected under, and the server is the authority on the reachable path. [[8-testing#3. Required coverage — the graded list]] maps each graded capability to the layer that proves it.

### Backend unit tests
- Most of the suite. Pure functions in `packages/shared`: rule evaluation, publish-time validation, snapshot `formatVersion` upgrade, answer canonicalization. No Fastify, no database.
- Client and server run the same evaluator, so one suite covers both. Two evaluators would need two suites and could still drift.
- Table-driven with `it.each`: every operator against every response type it is defined for, plus the cases the type system should make unrepresentable, pinned with `@ts-expect-error`.
- Absent-answer semantics (a condition on a question that wasn't shown is `false` for every operator) and the medical-condition demo are explicit cases.
- Detail: [[8-testing#2.1 Domain unit — the shared package]].

### Backend integration tests
- Fastify `app.inject()` runs a synthetic request through hooks, validation, handler and error handler in-process, with no port. The entrypoint is split into a `buildApp()` factory and a thin `server.ts` to allow it.
- Registering one plugin on a bare instance and driving it to completion checks the definition/execution separation mechanically ([[7-application-boundary#3.1 Module encapsulation]]).
- **Real Postgres from Testcontainers, never a mock.** The invariants under test are the immutability trigger, the one-draft partial index, the append-only audit role, and `qp_definition`'s missing grant on `response`. A mocked repository passes with all four absent.
- One `postgres:16-alpine` container per run. Migrations run once into a template database, and each Vitest worker clones its own with `CREATE DATABASE ... TEMPLATE`. Roles come from the same `db/init/01-roles.sh` compose uses.
- A worker's connection budget is bounded by its concurrency, not its test count: `connect(role)` closes in `afterEach`, and pools are capped ([[12-decisions-log]] #77).
- `TEST_DATABASE_URL` skips the container, for CI without a Docker socket.
- Immutability is tested in all three places it is enforced, including one test that bypasses the API and writes to the database directly.
- Repository tests (`_tests/db`) own what the database decides; route tests (`_tests/modules`) own the status, problem type and headers. A scenario belongs to one layer.
- Detail: [[8-testing#2.2 Backend integration — Fastify `inject()` against a real Postgres]], [[8-testing#4. Postgres for integration tests — Testcontainers]].

### Frontend tests
- Vitest with React Testing Library on jsdom. Vitest rather than Jest so there is one transform and resolution config in the repo. The test API is Jest's.
- Covers each response type's input, required-ness messages, and that the form's next-question decision matches the shared engine. The engine is imported, not restated, so a test cannot hold a second opinion about branching.
- Queries use `getByRole` and `getByLabelText`, so the form's labelling is tested as a side effect.
- Layout and styling are not tested here.
- Detail: [[8-testing#2.3 Frontend component — Vitest + React Testing Library]].

### End-to-end tests
- Three Playwright specs (Chromium, headless) against the composed stack through nginx, on the production images, so what is tested is the artifact a reviewer runs.
  1. The mandatory branching demo, authored through the admin UI.
  2. Resume: abandon a session, return, continue with answers intact.
  3. The v2 publish boundary: a v1 response still renders with v1's prompts and still aggregates on `questionId`.
- Specs 2 and 3 seed through the definition API. Clicking through authoring to set up a precondition is how these suites get slow and brittle.
- The specs need only a `baseURL`, so the same three run after a deployment as a smoke test. That is how this works under Kubernetes without a second suite.
- Detail: [[8-testing#2.4 End-to-end — Playwright against the composed stack]].

### Structure and enforcement
- **One command locally.** A root Vitest config with `projects` makes `npm test` run the shared, backend and frontend suites; `npm run test:e2e` stays separate so the fast suite doesn't inherit the slow one's runtime.
- **Parallel jobs in CI** (`.github/workflows/ci.yml`): lint, typecheck, build, unit tests in four shards, a "Response telemetry leak test" job, and end-to-end, after a `changes` job that skips them when only Markdown changed. CI is the gate; the `lefthook` pre-commit hook is convenience, because `--no-verify` exists.
- **The telemetry leak test** plants a sentinel where an answer could reach the code and asserts it appears in no log, span, metric or exported record ([[#14. Observability]]).
- **Fixtures.** The seeded demo has one builder in `packages/shared`, used by both the seed and the tests, so the demo that ships and the fixture under test cannot drift. Factories with overrides, not fixture files. Time is frozen with `vi.setSystemTime`, and nothing sleeps.
- **ESLint enforces the architecture, and the rules are themselves tested** (`tests/lint-*.test.ts`), so a misconfigured rule fails a test instead of silently allowing a violation. Examples:
  - Module boundary: `no-restricted-imports` zones stop `modules/definition` and `modules/execution` importing each other; `modules/telemetry` may not import the db layer, `drizzle-orm` or `pg` at all.
  - Telemetry boundary: `pino` and `@opentelemetry/*` may be imported only inside `packages/telemetry`, and a custom rule rejects casting a value into a log message or span name.
  - One transport: `fetch` is allowed only in `apps/*/src/api/**` and the telemetry SDK's transport.
  - One connection factory: constructing a `pg` client or pool is warned on outside `db/client.ts` and the test harness. Raw SQL in the backend is warned on outside the schema file.
  - Casts: a double assertion (`as unknown as T`) warns everywhere. A disable comment must carry a reason.
- Deferred, in [[8-testing#9. Open questions]]: property-based testing of the rule engine, load testing to substantiate [[3-scaling]], accessibility assertions, mutation testing.

## 16. Scale & Growth

> **Detail: [[3-scaling]].** The brief's five areas; each lever there has a trigger and none is built before it fires.

| Area | Built now | Next lever |
| --- | --- | --- |
| [[#Read traffic]] | One definition fetch per session, evaluated in the client; in-process cache of compiled definitions | CDN for static assets, shared Redis cache |
| [[#Data growth]] | Monthly partitions on `response`, every index tied to a query | Archive old partitions to cold storage |
| [[#Reliability]] | Idempotent, all-or-nothing submit; resumable sessions; separate pools per surface | Connection pooler, read replica, durable ingest queue |
| [[#Change control]] | Immutable versions, additive migrations, migrate step gates the backend | None needed |
| [[#Operations]] | Request metrics, saturation signals, domain events and nine alert rules; answers excluded from telemetry | SLOs and error budgets, backup verification |

### Read traffic
**Built now**
- The client fetches the whole published definition once per session, inside the session response, and evaluates branching locally with the shared engine ([[#7. Branching Rules]]). There are no per-answer reads.
- Each backend replica caches the compiled definition in process, keyed by `(questionnaire, version)`. It never needs invalidating because a published version never changes. The current-version pointer has a short TTL.
- The pinned definition endpoint is `private` and immutable, and no shared cache or CDN holds a definition (Decisions Log #44).

**Next lever**
- A CDN for the respondent bundle and static assets only.
- A shared Redis cache for definitions, when replica count makes in-process cold starts noticeable.
- Detail: [[3-scaling#4. Problem: hot definition reads]].

### Data growth
**Built now**
- `response` is append-only and range-partitioned monthly on `created_at`, set to the session's `submitted_at` so a session's rows sit together ([[#Partitioning and indexes]]).
- There is no `DEFAULT` partition, so a missed rollover fails loudly.
- Every index ties to a named query or invariant ([[9-database-schema#7. Indexing strategy]]). There is no GIN index over the snapshot, since access is whole-document.

**Next lever**
- Archival: detach older partitions to cold storage on a per-questionnaire retention policy.
- Detail: [[3-scaling#3. Problem: response ingest vs. reads]].

### Reliability
**Built now**, by failure mode:
- **A retried submit** (network drop, double click). Submit is idempotent on the session through a stored digest of the canonical answers (Decisions Log #19, #37). A retry replays the original receipt.
- **A conflicting second submit.** Different answers for an already-submitted session get `409`; the first submission stands.
- **A failure partway through a submit.** Validation and the write happen in one transaction, so a submission is stored whole or not at all. There is no half-saved session to clean up.
- **A respondent who leaves or the tab closes.** Partial answers stay in the browser, and the session row pins the version, so the respondent resumes on the same version for 7 days ([[#8. Sessions & Responses]]). Nothing is written to the server between start and submit.
- **Load on one surface starving another.** Respondent, authoring and admin reporting use separate database roles and pools ([[#9. API / Service Boundary]]), so a slow admin query does not take respondent connections.

**Next lever**
- A connection pooler (PgBouncer, transaction mode) once a fourth backend process would exhaust Postgres's connections (Decisions Log #78).
- A read replica for admin and analytics queries.
- A durable ingest queue (Redis Streams with AOF, ack after commit) when the primary's write capacity saturates. A lost acknowledged submission is the worst failure this design has, so the queue must not be fire-and-forget.
- Detail: [[3-scaling#3. Problem: response ingest vs. reads]].

### Change control
**Built now**
- Published versions and question versions are immutable and append-only ([[#6. Versioning & Immutability]]), so a migration only adds and never reconciles a changed definition.
- `drizzle-kit` generates committed, reviewable SQL migrations. Roles come from `db/init/01-roles.sh`, never a migration, so a schema change and an access change are separate reviews ([[9-database-schema#11.3 Roles are not schema, and must not be in a committed migration]]).
- A one-shot `migrate` service gates the backend in Compose, and a migrate Job does the same in Kubernetes ([[#Kubernetes]]). A release never serves traffic against a schema, or a `formatVersion`, it predates.

**Next lever**
- None needed for the prototype.

### Operations
This area is about running the system under load: knowing it is healthy, being told when it isn't, and finding out why.

**Built now**
- **Is it working?** Request rate, error rate and latency for every endpoint (the "RED" signals), derived from traces.
- **Is it running out of room?** Node event-loop lag and how long requests wait for a database connection. These rise before users see errors.
- **Where do respondents drop off?** Domain events such as sessions started, completed and abandoned, counted as metrics and logged.
- **Who tells us?** Nine Grafana alert rules ship as files. Six watch the backend (submit success rate, 5xx rate, definition-fetch latency, event-loop lag, connection-pool waits, and the `response` partitions running out) and three watch the browser client.
- **Safe to collect.** Respondent answers are structurally excluded from every signal, and the audit trail of who published or retired what lives in the database, not the log pipeline ([[#14. Observability]]).

**Next lever**
- SLOs with error budgets, so alerts fire on how fast a target is being missed rather than on fixed thresholds.
- Backup monitoring and a restore drill. A backup is only evidence once a restore has worked.
- Detail: [[6-observability#8. SLOs and alerting]].

## 17. Open Questions

Ordered roughly by what blocks what. Deferred work with a stated direction is under [[#18. Future Work]] instead.

1. **In-flight sessions at retirement.** The hard cutoff ships now ([[#Retirement]]). Whether `cutoffMode: 'hard' | 'soft'` becomes a per-questionnaire setting is undecided. Also in [[3-scaling#8. Open questions]].

2. **Snapshot format support window.** How many past `formatVersion`s the loader commits to upgrading from, and what triggers dropping support for one.

3. **Admin reporting beyond the shipped browser.** The admin responses browser is built (gh#18), reading through the dedicated read-only `qp_reporting` role, with sorting by either timestamp and every raw-answer read audited ([[12-decisions-log]] #89–#91). Still open: domain-event access, an audited export of raw answers, aggregation, and who may read the screen at all. The sharper problem is that **`/api/reporting` is unauthenticated (no auth exists anywhere in the prototype) and its list returns the ids of `in_progress` sessions, each a live bearer capability for `GET /api/run/sessions/:id` and `POST /api/run/sessions/:id/submit`, so anyone who can reach the admin screen can resume and submit a stranger's in-flight session.** That follows from the no-auth posture rather than from this screen, and showing only the first 8 characters of an id in the UI does not mitigate it. Candidate mitigations: [[7-application-boundary#10. Open questions]] §2; the model it strains: [[7-application-boundary#7. Access model and data barriers]].

4. **Rate limiting the execution surface.** Only `/api/telemetry` is rate limited ([[12-decisions-log]] #97). `POST /sessions` is unauthenticated and trivially abusable. `@fastify/rate-limit` is a small addition; whether it ships in the prototype or is stated as an edge concern is open, and it interacts with where a service split would put the public ingress.

5. **Discarding never-published drafts.** The one plausible exception to "nothing is deleted" ([[#3. Constraints]]): a draft that was never published is work in progress rather than a record, and an author who abandons one has no way to clear it. **Partly resolved:** removing items *from* a draft is settled by Decisions Log #45 — `qp_definition` holds `DELETE` on `questionnaire_item` only, and the item guard confines it to drafts. Discarding a *whole* draft is still punted — drafts are harmless at prototype scale and the partial unique index already limits them to one per questionnaire — and would need `DELETE` on draft `questionnaire_version` rows plus a decision on `ON DELETE CASCADE` ([[#12. Database]]). Question versions are out of scope here — those are append-only by [[12-decisions-log]] #13 regardless.

6. **Timezone semantics for relative date constraints — provisional.** `not_future` / `not_past` are evaluated server-side against UTC today with **one day of tolerance**, while the respondent app evaluates them against the browser's local date (Decisions Log #38, [[5-questionnaire-format#2.4 Relative date constraints resolve against two different clocks]]). A strict UTC comparison would block a correct answer for any respondent far enough east or west, which is an outage; the tolerance accepts a date at most one day beyond true, which is a data-quality rounding error. The exact alternative — the client submits its UTC offset with the session or the submission and the server validates against the respondent's own calendar — costs a field on the wire, a decision about trusting it, and a decision about storing it so the check stays reproducible later. Worth revisiting if there is time; not worth the machinery before the vertical slice is complete.

7. **Taken question `key` returns `500`** ([gh#15](https://github.com/kenziesimpson/questionnaire-platform/issues/15), [[12-decisions-log]] #65). `key` has no reader, so the field may be removed rather than mapped to a `409`.

8. **Creating roles on managed Postgres** ([gh#92](https://github.com/kenziesimpson/questionnaire-platform/issues/92)). In Compose the `roles` service runs `db/init/01-roles.sh` against the `db` container. Managed Postgres has no such container, and its admin user usually isn't a superuser. Options: infrastructure code, a setup Job running the same script, or the provider's IAM auth. Whichever wins must stay the only path that creates roles.

9. **After split FE/BE, how to handle mismatches** We would eventually want to split their deployment, and they're currently tightly coupled/share a lot of code, so we would need ot put some thought into disentangling that a bit.

## 18. Future Work

### Architecture and scale
- **Split the frontends.** Deploy the respondent questionnaire app and the admin portal separately; the questionnaire app is potentially hit much harder and benefits from a CDN, aggressive caching and edge rate limiting, while the admin portal stays behind auth. Keep them as separate entry points/packages from the start so this is a deploy change. See [[3-scaling#6. Future improvement: split the frontends]].
- **Split definition and execution into separate services.** Chiefly a security improvement: the authoring API then need not be routable from the public internet at all, and a vulnerability reached through the unauthenticated respondent surface would land in a process whose database role cannot touch authoring tables and whose network cannot reach the admin service. Also buys independent scaling (respondent traffic is orders of magnitude higher) and decoupled deploy cadence, so authoring releases stop restarting the surface that collects medical answers. The prototype deliberately keeps this a deployment change rather than a rewrite — see [[7-application-boundary#8. Deployment topology]].
- Redis as cache and (separately) durable ingest queue, triggered by measured load. See [[3-scaling#3. Problem: response ingest vs. reads]] §3–5.

### Data integrity, security and compliance
- **Close the duplicate `option_ids` shape in the database.** An `IMMUTABLE` helper wrapping `SELECT count(DISTINCT e) FROM unnest(a) e`, called from the `multiple_choice` branch of `response_shape`, is the one remaining thing needed to make every invalid answer shape unrepresentable rather than merely rejected. Deferred under Decisions Log #33 and #34 because a correct client cannot produce the shape and the validator already covers it; it returns as one custom migration with no application change — [[9-database-schema#13.8 An `IMMUTABLE` helper closing duplicate `option_ids`]].
- **Erasure on request (GDPR / HIPAA).** The stated exception to [[#3. Constraints]]: removing one respondent's data as an explicitly invoked, audited operation, including from snapshots' derived indexes and cold-storage partitions. Deliberately not a cascade delete.
- **Withholding unreachable questions from the definition payload** in sensitive deployments. Tracked in [[3-scaling#8. Open questions]]; ties to HIPAA work.
- **Standalone audit logging service.** Extract the audit trail behind a transactional outbox so it can be operated, backed up and access-controlled independently of the application database. The schema-and-role design shipping now (Decisions Log #16) is deliberately outbox-ready: audit writes go through a single repository function, and audit rows carry their own id and timestamp rather than borrowing the domain row's. See [[6-observability#5.1 Isolation — separate schema with a restricted role]].

### Questionnaire model
- **Pages and sections.** Deferred, not rejected; [[5-questionnaire-format#1. The model]] states the constraint any future design must respect.
- **Format subtypes for `text`** — email, phone and regex-pattern validation. Pinned deliberately rather than rejected.
- **Unit conversion for `number`.** Answers already carry the unit they were collected under ([[#5. Questionnaire Format]]), so converting between compatible units (cm/in, kg/lb) for display and analytics is additive rather than a migration.
- **Question translation and locale-specific published snapshots.** Translate question text, option labels and help text, then serve the respondent a `snapshot` JSONB for their locale instead of the one canonical blob assumed today ([[#12. Database]] §2.1, [[9-database-schema#3. `definition`]]). Keys, ids, `constraints` and `visible_when` predicates stay locale-independent — only the human-readable strings vary — so this is additive: one publish producing N locale snapshots (or a base snapshot plus per-locale string overlays) rather than a schema change to the definition model.
- **A/B testing whole questionnaires.** Noted during ideation; deferred as orthogonal to the versioning model — a published version is already the unit an experiment would assign against.
- An AI-assist system for initializing a questionnaire

### Authoring and admin
- **Independently versioned question bank.** Drafts and a publish step on questions themselves, for authors who need to park half-finished edits. Additive over today's append-only model — see [[5-questionnaire-format#7. Alternatives considered]] §7.5.
- **Upgrade a draft to the latest question versions.** A per-question review action, so moving a questionnaire forward does not mean removing and re-adding items.
- **A question version picker in the draft editor.** Choose which version of a question an item pins, rather than taking whatever was current when it was added. This is also the change that makes concurrent-edit divergence (Decisions Log #31) visible at the moment it matters, instead of leaving it to be noticed in version history.
- **Archiving follow-ups** ([[12-decisions-log]] #75): an unarchive route, the picker showing archived questions already placed in the open draft, and a warning when archiving a question that sits in open drafts.
- **Version diffing** (`GET /versions/:a/diff/:b`), making "what changed in v2" a first-class answer. Additive: both snapshots are already retrievable and the admin app can diff client-side.
- **Who published a version.** `VersionSummary.publishedBy` is `null` until authentication gives real identities; then `published_by` needs a migration and a change to `promote_draft` ([[12-decisions-log]] #64).

### Respondent app and frontend
- **Checkpoint endpoint and true cross-device resume.** `PUT /sessions/:id/progress`, upserting partial answers on a debounce. It becomes worth its cost once respondents have an identity to look a session up by, rather than only a bearer session id sitting in the same browser storage as the answers it would recover (Decisions Log #25). Additive: one table, one grant and one route, with the shape already recorded in [[9-database-schema#12. Open questions]] and nothing existing to migrate.
- **"Start over" on a resumed respondent session** ([[12-decisions-log]] #74, [gh#35](https://github.com/kenziesimpson/questionnaire-platform/issues/35)). Clears the answers and keeps the same session, since a new session would leave two in progress for one respondent.
- **A dropdown presentation for `single_choice`.** Today it renders as a radio group. The control already keeps the answer mapping apart from the view that draws the options, so a select is a second view behind the same props rather than a new control ([[10-frontend#3. `packages/ui` — primitives and the renderer]]).
- **A view listing every current error per question.** The renderer shows only the first `SubmissionItemCode` for an item; a question failing two rules reveals the second only once the first is fixed. Listing all of them is a change inside the renderer's error catalogue and field components, since the `errors` prop already carries the full list ([[10-frontend#3. `packages/ui` — primitives and the renderer]]). Tracked alongside the draft editor's inline error rendering as [gh#22](https://github.com/kenziesimpson/questionnaire-platform/issues/22), Decisions Log #54.
- **React Aria in place of Radix primitives.** Considered and passed over for now ([[10-frontend#9.5 React Aria instead of Radix]]); the migration is deliberately contained, because `packages/ui/primitives/` is the only place Radix is imported and everything else consumes primitives, so a swap happens one primitive at a time behind unchanged props. Two things would trigger it: **localisation**, which brings date, number and unit input that must be correct per locale — React Aria's strongest ground and the point at which native inputs stop sufficing — and a real **screen-reader conformance requirement**, since React Aria carries substantially more platform-specific behaviour.

### Operations
- **Invariant monitoring and a synthetic leak test.** Periodic gauges for orphaned answers, never-shown items and live snapshot format versions — drift that returns HTTP 200 and moves no existing signal — plus a leak test completing the medical-condition demo questionnaire end to end, which is the only signal that proves the *workflow* works rather than that the processes are up. Cheap to build here because the demo questionnaire already exists. See [[6-observability#9. Correctness and invariant monitoring]].
- **Deploy and migration markers on dashboards.** Most incidents are change-caused, and "what changed at 14:02" is the first question in all of them.
- MCP for logs
