# Dynamic Questionnaire Platform — Design Doc

> Status: **scaffold** — sections are filled in as decisions land. Prompts in *italics* are the questions each section should answer; delete them once answered.
> Related: [[1-ideation]], `.claude/skills/questionnaire-assignment/SKILL.md` (outside the vault index), assignment brief (Claude Project).

## 1. Overview

*One paragraph: what the system is, who uses it (admin vs. respondent), and the primary end-to-end workflow we are demonstrating.*

## 2. Goals

*What "done" means for this prototype. Tie each goal back to a required capability or review dimension in the brief.*

- 

## 3. Constraints

*Hard limits we are designing within: time, single developer, must be runnable with one command, published versions immutable, etc.*

- **Nothing is deleted; things are hidden.** A general principle rather than a per-entity rule: questionnaires retire via `closes_at` ([[#8. Sessions & Responses]] §8.1), questions are archived rather than removed, question versions are append-only, and published snapshots and collected responses are immutable. Most of the design had already converged on this independently — stating it explicitly is what makes that coherent rather than coincidental, and it is the rule to apply when a new entity's lifecycle comes up. The risk being avoided is data loss, and in this domain the data is someone's medical history. See Decisions Log #15.
  - **Known exception: erasure on request.** A production system under GDPR or HIPAA must be able to remove a specific respondent's data. That is a separate, explicitly invoked, audited capability — never something normal operation does — and the distinction is what keeps "nothing is deleted" true as an operational statement. Out of scope for the prototype; see [[#19. Future Work]].
  - Archival ([[3-scaling#3. Problem: response ingest vs. reads]] §3.6) moves old partitions to cold storage. That is movement, not deletion, and stays inside the principle.

## 4. Out of Scope

*Capabilities we are intentionally deferring, with a one-line note on how each would be addressed in production. (The brief asks us to make these explicit.)*

| Deferred capability | Why deferred | Production approach |
| --- | --- | --- |
| Authentication / authorization | Not required to demonstrate the core workflow; would consume time better spent on versioning and branching. | Define the access *model* and data barriers now (admin vs. respondent, session ownership) so auth can be slotted in. Assume an upstream identity provider (OIDC) and enforce roles in a Fastify hook. |

## 5. Questionnaire Format

> **Detail: [[5-questionnaire-format]].** Summary only here.

A questionnaire version is a **flat, ordered list of items**. Each item places one question version at an index and carries the questionnaire-specific concerns — `required` and an optional `visibleWhen` predicate. Reusable question content carries neither: where a question sits, whether it is required there, and what makes it appear are properties of the placement, not of the question.

There are no edges between questions. Order is the list index, and the next question is the first unanswered item whose predicate is true, so convergence after a branch is not a property to prove — it is the only thing a list can do.

Six response types — `text`, `single_choice`, `multiple_choice`, `number`, `date`, `yes_no` — with `yes_no` as sugar over `single_choice` on reserved `yes` / `no` option ids. Two identity guarantees carry the versioning story: **option ids are stable across question versions**, and **number answers are stored with their unit**. Both exist so that revising a question cannot retroactively change what an earlier response meant.

A published version serializes to a single JSONB document carrying its own `formatVersion` ([[#12. Database]] §12.1).

See Decisions Log #6, #10, #11, #12.

## 6. Versioning & Immutability

> **Detail: [[5-questionnaire-format#6. Versioning mechanics]].**

**Questionnaires.** At most one draft at a time, enforced by a partial unique index rather than application logic. **Publishing promotes the draft row in place** to version *N*; the next draft is an explicit copy of the latest published version. A published version is never edited.

**Questions.** Append-only, with no draft state on the bank: every save writes a new immutable `question_version` row, so saving *is* publishing. A stable `questionId` carries identity across revisions, and a questionnaire item pins a `questionVersion` at the moment the question is added and keeps it, so a draft never shifts under its author. Questions are archived, never deleted ([[#3. Constraints]]).

**Responses** store `questionId` — what you aggregate on — alongside `questionVersion` (what you render with), the questionnaire version, and option ids. The version is derivable from the snapshot; storing it anyway keeps a response interpretable without loading the definition it was collected under. The line stops at the version pointer: prompt text is not copied onto responses.

Immutability is enforced in three layers: a database trigger rejecting `UPDATE` on published rows — that is the guarantee — a `409` from the authoring API for a usable error, and a test that drives the update straight at the database so the guarantee cannot silently regress behind a service-layer refactor.

The published snapshot carries a `formatVersion` and is upgraded **in memory at read time**; stored bytes are never rewritten. Immutability here means the bytes, not merely the meaning — the stored document is the record of what a respondent was actually shown.

See Decisions Log #7, #8, #13, #14.

## 7. Branching Rules

> **Detail: [[5-questionnaire-format#4. Branching rules]] and [[5-questionnaire-format#5. Publish-time validation]].**

Each item carries an optional `visibleWhen` predicate: a **single level** of `all` / `any` over conditions **typed per response type**, so an invalid comparison such as a date against a number is unrepresentable in the shared package rather than a runtime error class. Predicates may reference only questions at a lower index.

Next question is the first unanswered item whose predicate is true; completion is running off the end of the list. A condition on a question that was not shown evaluates to `false` for every operator, negative ones included — a condition means *the answer exists and satisfies the operator*.

**Cycles and deadlock are not detected, they are unrepresentable.** Forward-only references make a cycle unconstructible, and falling off the end of the list is always available as a terminal state. Publish-time validation therefore covers forward references, satisfiability and referential integrity. Satisfiability is checked exactly, by domain intersection — affordable precisely because composition is flat.

One evaluator in the shared package, used by both the client (rendering) and the server (submit-time authority).

See Decisions Log #6, #9.

## 8. Sessions & Responses

*Execution-side data and behavior.*

- *Session lifecycle (start → in-progress → submitted) and resume.*
- *Response storage and validation (required, value constraints).*
- *Behavior when a questionnaire is republished while sessions are in flight.*
- *Idempotency / duplicate submission handling.*

### 8.1 Questionnaire lifecycle and retirement

Retirement is a property of the **questionnaire**, not of a version. Retiring never un-publishes a version: every published version stays readable so historical responses can still be rendered against the definition they were collected under.

The two lifecycles the product needs — questionnaires that run indefinitely, and questionnaires that close on a date — collapse into **one nullable `closes_at` timestamp**:

| Lifecycle | Representation |
| --- | --- |
| Ongoing | `closes_at IS NULL` |
| Scheduled close | `closes_at` set to a future date |
| Retired now | `closes_at` set to `now()` |

One field and one comparison, rather than a status enum plus a date that can drift out of agreement with each other.

**Behaviour past `closes_at`:** starting a session and submitting one are both rejected, and the respondent app renders a "responses closed" page rather than a raw error. This is a **hard cutoff** — a session started before the close but submitted after it is rejected too.

That is the strict choice and it has a real cost: a respondent can lose completed work through no fault of their own. The alternative, a **soft cutoff** admitting any session that started before `closes_at`, is kinder but leaves the close date open-ended for an unbounded window. The likely resolution is a per-questionnaire `cutoffMode: 'hard' | 'soft'` defaulting to hard. Deferred — [[#18. Open Questions]] §3 and [[3-scaling#8. Open questions]].

## 9. API / Service Boundary

*The explicit line between questionnaire definition (authoring, publishing) and questionnaire execution (sessions, responses).*

- *Endpoint groups / modules and what each owns.*
- *Error format, status code conventions, input validation approach.*
- *Access model and data barriers (auth itself may be stubbed, but the model should be stated).*

## 10. Frontend

**Decision:** React + TypeScript, built with Vite, served as a plain SPA. See Decisions Log #1.

- *Admin experience: screens and critical workflow.*
- *Respondent experience: rendering, dynamic next-question, local progress/resume.*
- Deployment shape: built SPA served by its own nginx container, which reverse-proxies `/api` to the backend as a stand-in for a production ingress (see [[#13. Deployment]]). Assets can move to a CDN later without code changes.

## 11. Backend

**Decision:** Node LTS + Fastify + TypeScript. See Decisions Log #2, #3.

- Rationale: lightweight, schema-based request validation built in (JSON Schema / TypeBox), first-class plugin ecosystem including `@fastify/otel` for observability later, and a mature Node-compat surface so plugins and instrumentation "just work".
- API types shared with the frontend through a common workspace package.
- *Module / layer layout (authoring, publishing, execution, storage).*
- *Transaction management and concurrency control (concurrent admin edits, concurrent respondents).*

## 12. Database

**Decision:** PostgreSQL, accessed via Drizzle ORM over the `pg` (node-postgres) driver, with `drizzle-kit` generating SQL migration files. See Decisions Log #4.

- Rationale: Postgres gives transactions for publish operations, JSONB for storing immutable published definitions, and native partitioning for response-history growth. Drizzle keeps the schema in TypeScript, emits readable/committed SQL migrations, and stays close enough to SQL for partitioning, JSONB queries and `SELECT ... FOR UPDATE`.
- Connection pooling: `pg` pool in-process for the prototype; PgBouncer (or a managed pooler) is the first scaling step.
- Driver is swappable (e.g. Drizzle's `bun-sql` adapter) if the runtime ever moves to Bun.
- *Schema: entities, relationships, key constraints (link to ERD or inline diagram).*
- *Read/write characteristics: questions (write reliability, read SLA) vs. responses (write throughput).*
- *Indexing strategy.*
- Audit trail: an `audit` schema in the same instance, written through a dedicated role with `INSERT`/`SELECT` only and `UPDATE`/`DELETE` revoked, so append-only is a database guarantee rather than a convention. The audit write joins the publish transaction. Extracting it to a separate database or its own service later goes via a transactional outbox — kept cheap by design, not built now. See [[6-observability#5.1 Isolation — separate schema with a restricted role]].

### 12.1 Authoring is normalized; published is a snapshot

Two representations of the same questionnaire, with publish as the seam between them. See Decisions Log #7.

**Authoring side — normalized rows.** Question bank, question versions, questionnaire drafts and draft items are ordinary relational tables. This is where foreign keys, partial edits and the reuse query ("which questionnaires use this question?") need to work naturally.

**Published side — one JSONB document per version.** Publishing runs in a single transaction: read the normalized draft, run the [[5-questionnaire-format#5. Publish-time validation]] validations, serialize to JSONB, flip the row to `published`. The result is read whole and never partially updated.

Why the split:

- The client fetches the entire definition once per session ([[3-scaling#2. Load model (what actually hits the backend)]]), so the read pattern is "give me all of it" — exactly what one row satisfies and what a four-way join plus row assembly does badly, on every session start.
- A `(questionnaire, version)` document is immutable, so it can be served with `ETag` and `Cache-Control: immutable` and held compiled in an in-process cache that never needs invalidating ([[3-scaling#4. Problem: hot definition reads]]).
- Immutability is enforced on one row in one table instead of being spread across item, option and rule tables.

**The duplication is the point, not an accident.** Question content exists both in the bank row and inside every snapshot that used it. That redundancy is what immutability *means* here: a published version cannot be disturbed by a later edit to the question it was built from.

**Reverse lookups get a derived side-table.** "Which published versions contain question X?" is the query a snapshot makes awkward. Rather than lean on a GIN index over the document, publish also writes rows into a thin `version_question_index` mapping version to question version ids. The snapshot stays authoritative; the side-table is a derived index that can be rebuilt from the snapshots at any time.

**On JSONB specifically.** `jsonb` parses on write into a decomposed binary form — key order and whitespace are not preserved, duplicate keys collapse, writes are slightly slower, reads and operators much faster. It is a queryable document type (`->`, `->>`, `@>`, `?`, GIN indexes), not merely a blob type; we use it in a blob-like way because our access pattern is whole-document. Documents above roughly 2 KB are TOASTed out-of-line, and the binary layout means reading one field from a TOASTed document generally de-TOASTs all of it — irrelevant here for the same reason, and a further argument for the side-table over a GIN index.

## 13. Deployment

**Decision:** Each component deployed as its own container — frontend, backend, database — orchestrated with Docker Compose for local development and the prototype demo. Long-term target is Kubernetes with the same three-way split. See Decisions Log #5.

### 13.1 Local / prototype (Docker Compose)

| Service | Image / role | Notes |
| --- | --- | --- |
| `frontend` | nginx serving the Vite production build | Reverse-proxies `/api/*` to `backend` so the browser stays single-origin (no CORS, no build-time API URL). |
| `backend` | Node LTS + Fastify | Stateless; config entirely from env vars. `depends_on` the `migrate` service completing successfully. |
| `migrate` | One-shot: `drizzle-kit migrate` + demo-questionnaire seed | Runs after `db` is healthy, exits 0. |
| `db` | `postgres:16` | `pg_isready` healthcheck; named volume for persistence. |

- One command for a reviewer: `docker compose up` builds and runs the production-shaped stack, seeded with the medical-condition demo questionnaire.
- Configuration: environment variables only, with a committed `.env.example`. No secrets in images.
- Redis (from ideation notes) intentionally not included until a concrete need (session cache, rate limiting) appears — see Future Work.

**Reverse proxy — a stand-in for the production edge.** The nginx in the frontend container is filling a role that a production system fills elsewhere: in Kubernetes the ingress controller (nginx/Envoy/Traefik) routes `/api` → backend and `/` → frontend, and on a cloud platform the load balancer or CDN does the same path-based routing. The *principle* — single origin for the browser, path-based routing in front of the app — is permanent; only the implementation moves. Static assets likewise move to a CDN/object storage in production, leaving the ingress to route only. Keeping the proxy avoids CORS config, `SameSite` cookie issues and a build-time API URL baked into the bundle.

**Migrations have a dedicated owner.** Something must run `drizzle-kit migrate` and the seed before the API serves traffic. Options considered: (a) backend runs migrations at startup — simple, but with >1 replica both race to migrate, and schema changes become coupled to app restarts; (b) run manually — fails "one command" and repeatability; (c) a dedicated one-shot process. We use (c): the `migrate` service gates the backend via `depends_on: condition: service_completed_successfully`, giving a deterministic boot order (db healthy → schema + seed → API) that works with any number of backend replicas. In Kubernetes this becomes a Job that must succeed before the new backend rollout, which is also how a release protects published questionnaires (see [[#16. Scale & Growth]]).

**Dev loop / hot reload.** `docker-compose.override.yml` is auto-merged by `docker compose up` and is committed but local-only in effect. It changes two things per app service: the command (`frontend` → Vite dev server, `backend` → `tsx watch`) and bind mounts of the source directories. Vite pushes changes to the browser via HMR; `tsx` restarts the API. The base file is untouched, so a production build or CI run (`docker compose -f docker-compose.yml up`) gets real multi-stage images with no dev tooling. *Known issue, anticipated up front:* file-change events through bind mounts on macOS can be sluggish or missed, so the Vite config enables its built-in `server.watch.usePolling` from the start rather than waiting to hit it. `tsx watch` has no polling flag (it uses its own native watcher, not chokidar); it relies on Docker Desktop's VirtioFS event propagation, which is generally reliable — if a backend edit is ever missed, restarting the `backend` container is the fallback.

### 13.2 Long-term (Kubernetes) — *to be filled in*

- *Frontend and backend as separate Deployments + Services; ingress routes `/api` → backend, `/` → frontend; static assets to CDN.*
- *Managed Postgres (not in-cluster) for durability, backups, HA.*
- *Migrations as a Job gated before rollout.*
- *HPA on backend; config via ConfigMap/Secrets; readiness/liveness probes.*
- *Image build + registry + rollout strategy (blue/green vs. rolling) and how it preserves published questionnaires — ties to [[#16. Scale & Growth]].*

## 14. Observability

**Decision:** OpenTelemetry end to end, with respondent answer values structurally excluded from every signal. Full reasoning, field lists, metric names and enforcement design in [[6-observability]]. See Decisions Log #13.

- **OpenTelemetry as the single instrumentation standard** for traces, metrics and logs. Backend uses the Fastify OTel plugin (`@fastify/otel`) — one of the reasons Fastify was chosen (Decisions Log #2). A Collector is the only component that knows which telemetry vendor sits behind it, so that choice can change without touching application code.
- **Correlated frontend and backend.** The browser propagates W3C trace context (`traceparent`) on API calls so a respondent-side event and the backend request it triggered share a trace id. The app is single-origin through the nginx proxy ([[#13. Deployment]]), so this needs no CORS allowances.
- **Client-side telemetry is not optional here.** The SPA holds the whole definition and evaluates visibility predicates in the browser, so the server never observes most navigation decisions — server traces are structurally blind to the path a respondent actually took. Client traces and domain events batch to a backend `/telemetry` endpoint (not a publicly exposed collector) and flush via `navigator.sendBeacon` on tab close; without that, the abandonment event — the one we most want — is the one most likely to be lost, since abandoning and closing the tab are the same action.
- **Respondent answers never enter telemetry.** Question ids, types and validation outcomes are telemetry; answer values are not — not at `debug`, not inside an exception message, not as a metric label. The demo questionnaire collects medical conditions, so this is designed in rather than retrofitted. Enforced in layers: a `Sensitive<T>` wrapper whose serializers all return `[redacted]`, making an accidental leak structurally impossible rather than merely forbidden; a single telemetry module as the only permitted importer of pino/OTel (ESLint `no-restricted-imports`); an attribute allowlist applied in the span exporter, which also contains third-party instrumentation; and a test asserting a sentinel answer value appears in zero spans, zero logs and zero metric attributes. CI is the gate — the pre-commit hook is convenience, since `--no-verify` exists. An advisory agent PR review and a `telemetry-safety` project skill sit on top. Detail: [[6-observability#3. Respondent answers must never enter telemetry]].
- **Domain events as a first-class stream** — `questionnaire.published`, `session.started`, `session.resumed`, `session.item_skipped`, `session.answer_rejected`, `session.abandoned`, `session.completed` — each emitted as a paired log line and counter through one call, so the two cannot drift. This is what makes "why do respondents give up at Q7" answerable, and is the reason the design keeps a server-side session record ([[#8. Sessions & Responses]]).
- **Standard attributes on every span and log on the execution path:** session id, questionnaire id, version, question id, question type, outcome. In traces and logs only — **never as metric labels**, where per-session cardinality would take the metrics backend down. Metrics carry only bounded dimensions (endpoint, status class, question type, rule outcome).
- **Saturation metrics from the start:** event loop lag, heap and GC pauses (`@opentelemetry/instrumentation-runtime-node`), and `pg` pool `waitingCount`. These move before latency does, and no framework emits them by default. A sustained `waitingCount` distinguishes a pool bottleneck from a database one, which matters because the fixes differ.
- **The audit trail is not an application log.** Who published or retired which version lives in the database — an `audit` schema behind an `INSERT`/`SELECT`-only role, so immutability is enforced by Postgres and the audit write shares the publish transaction — with retention and integrity independent of the log pipeline. A separate audit database would place that write *outside* the transaction, allowing a publish with no audit record; the transactional outbox that fixes that is the documented path to a standalone audit service, deferred rather than rejected. See [[#12. Database]] and [[6-observability#5. Audit trail]].
- **One command stays one command.** Instrumentation is always wired; export is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and `docker compose --profile observability up` adds a Collector and a trace UI for anyone who wants to look.
- *Deferred, with direction recorded: SLOs, alert thresholds and backup verification ([[6-observability#8. SLOs and alerting]]); correctness/invariant monitoring for failures that return 200 and move no signal ([[6-observability#9. Correctness and invariant monitoring]]); deploy markers and a synthetic canary ([[6-observability#12. Change correlation and synthetics]]).*

## 15. Testing

**Stub — to fill in.**

- *Test layers (unit, integration, end-to-end) and tooling.*
- *Required coverage: versioning behavior, conditional navigation, the medical-condition demo, immutability, submit-time path validation (server as authority).*
- *Shared rule engine tested once, exercised by both client and server.*
- *How tests run locally and in one command (including against the compose Postgres).*

## 16. Scale & Growth

*Concrete reasoning for each area the brief calls out. Detailed design in [[3-scaling]].*

| Area | Approach |
| --- | --- |
| Read traffic |  |
| Data growth |  |
| Reliability |  |
| Change control |  |
| Operations | First-priority signals: RED per endpoint, Node saturation (event loop lag, `pg` pool waits), and domain events for session drop-off. Respondent answers are structurally excluded from telemetry. Audit trail in the database, not the log pipeline. SLOs, alerting and backup verification deliberately deferred. Detail in [[6-observability]]. |

## 17. Decisions Log

*Each decision with alternatives considered and why they were rejected. Append as decisions are made.*

| # | Decision | Alternatives considered | Rationale | Date |
| --- | --- | --- | --- | --- |
| 1 | Frontend: React + TypeScript via Vite, as an SPA with a separate backend | Next.js (unified FE/BE) | Next's strengths (SSR, SEO, auth ecosystem) don't apply to an admin tool / respondent flow with auth out of scope, while its App Router complexity does. The brief grades a clear definition-vs-execution service boundary and separation of concerns; a separate backend makes that boundary architecturally obvious instead of something a reviewer must trust. Vite is the current standard for React SPAs. | 2026-09-12 |
| 2 | Backend framework: Fastify | NestJS; FastAPI (Python) | Lightweight, built-in schema validation, `@fastify/otel` plugin for observability later. Nest adds boilerplate/DI ramp; FastAPI would mean two languages and generated rather than shared API types. | 2026-09-12 |
| 3 | Runtime: Node LTS (Bun optional for tooling only) | Bun as server runtime | Workload is I/O bound so runtime speed is not the bottleneck; scaling levers are pooling, indexing, caching, replicas. Bun's Node-compat layer still carries risk with Fastify plugins, pino transports and OTel instrumentation, and "straightforward to run" is graded. | 2026-09-12 |
| 4 | Data access: Drizzle ORM + `pg` driver + drizzle-kit migrations on PostgreSQL | Prisma; raw driver only (`pg` / `Bun.sql`) | Repeatable migrations and a reviewable schema are deliverables, so a raw driver is insufficient. Drizzle is SQL-close (partitioning, JSONB, row locks are natural), emits committed SQL migrations, and is driver-swappable. Prisma is heavier and abstracts more of the SQL. | 2026-09-12 |
| 5 | Deployment: separate frontend (nginx), backend and Postgres containers via Docker Compose; dedicated one-shot migrate/seed service; dev-only compose override with polling file watch; Kubernetes with the same split long-term | Single container serving SPA from backend; migrations at backend startup; manual migrations; Redis sidecar from day one | Three-way split mirrors the graded separation of concerns and is the same topology k8s will use. nginx proxy stands in for the production ingress and keeps the app single-origin. Dedicated migrate service gives deterministic boot order and survives multiple replicas. Polling watch chosen up front because bind-mount events on macOS are unreliable. Redis deferred until a concrete need. | 2026-09-12 |
| 6 | Questionnaire structure: a flat ordered list of items, each with an optional visibility predicate over earlier answers | Pointer/graph of questions with merge edges; adjacency-constrained optional segments (original ideation) | A graph needs an explicit merge edge per branch plus a proof that all paths converge, and makes cycles constructible. Adjacency buys convergence structurally but ties each rule to exactly one trigger question, which the brief's "one or more previous responses" rules out. A list makes order the index, convergence automatic, insertion a splice, and cycles and non-termination unrepresentable. Cost: no arbitrary jumps or loops, which the brief does not require. | 2026-09-12 |
| 7 | Published definitions stored as one JSONB snapshot per version; the authoring side stays normalized | Fully normalized published versions; JSONB for drafts too | The execution read pattern is "the whole definition, once per session", which one immutable row serves and a four-way join serves badly. Immutability lands on one row in one table instead of four. Normalized drafts keep foreign keys, partial edits and the question-reuse query. A derived `version_question_index` restores reverse lookups without a GIN index over the document. | 2026-09-12 |
| 8 | Publishing promotes the draft row in place to version N | Copy the draft into a new published row and retain the draft | Promotion means no moment exists where two rows describe the same pending version, and "at most one draft" becomes a partial unique index rather than application logic. The next draft is an explicit copy of the latest published version, which is the action an author actually wants. | 2026-09-12 |
| 9 | Branch conditions are a per-response-type discriminated union, grouped by a single level of `all` / `any` | Generic `{ questionId, op, value }`; arbitrary nested boolean expression tree | Typing conditions per response type makes invalid comparisons (date against number) unrepresentable in the shared package rather than a runtime error class to detect, message and test in an engine that runs on both client and server. One `all` / `any` level satisfies "one or more previous responses" without an unbounded tree needing recursive editing, validation and explanation. | 2026-09-12 |
| 10 | `yes_no` is sugar over `single_choice` with reserved option ids `yes` / `no` | A distinct boolean response type | One storage shape and one operator set for every choice question; reserved ids keep yes/no rules and cross-questionnaire analytics uniform. A separate boolean type would duplicate the choice machinery for the two-option case. | 2026-09-12 |
| 11 | Required-ness and branch predicates live on the questionnaire item, not on the reusable question | Both on the question version | A question is reusable; whether it is required, and what makes it appear, are properties of where it sits. Putting them on the question would force a duplicate question record whenever the same prompt is required in one questionnaire and optional in another, defeating the reuse the brief asks for. | 2026-09-12 |
| 12 | Number answers stored as `{ value, unit }`; option ids stable across question versions | Bare numeric answers with the unit resolved from the definition; storing option labels on responses | Both express the same invariant: a response must stay interpretable when its question is revised. A unit change (cm to in) or an option relabel in v2 cannot retroactively change what a v1 answer meant, and the stored response is readable without joining back to the definition. | 2026-09-12 |
| 13 | Questions are append-only with no draft state on the bank; questionnaire items pin a question version at add time | Independently versioned bank with its own draft/publish lifecycle; questions as mutable templates versioned only at the questionnaire level | Append-only gives real question versioning while keeping the bank's lifecycle to "insert a row" rather than a second draft-to-publish state machine, and it composes with the snapshot instead of duplicating it. Pinning at add keeps a draft stable between sessions and makes upgrading a visible act. Costs: an explicit save action (one save, one version) and no upgrade action yet. The independently versioned bank stays available later as an additive change. | 2026-09-13 |
| 14 | Responses store `questionId`, `questionVersion`, the questionnaire version and option ids | Store only `questionId` and derive the version from the snapshot; also denormalize prompt and label text onto the response | `questionId` is what aggregation across versions needs; `questionVersion` is derivable from the snapshot but stored anyway so a response is interpretable without loading the definition. The line stops at the version pointer — a unit changes what a value means numerically, prompt wording does not, and copying it onto every row buys nothing the snapshot does not already hold exactly. | 2026-09-13 |
| 15 | Nothing is deleted; things are hidden — retire, archive, append-only, immutable | Hard deletes with cascade; soft-delete flags on selected tables only | The data is medical history, so the risk of loss outweighs the tidiness of deletion, and most of the design had already converged here independently. Making it a stated principle means new entities inherit it by default rather than each lifecycle being re-argued. Erasure on request (GDPR/HIPAA) is the known exception and is a separate audited capability, not normal operation. | 2026-09-13 |
| 13 | Observability: OpenTelemetry end to end; respondent answer values structurally excluded from telemetry (`Sensitive<T>` wrapper + single telemetry boundary + exporter allowlist + sentinel test gated in CI); domain events as a first-class stream; audit trail in an `audit` schema behind an `INSERT`/`SELECT`-only role rather than in the log pipeline; client-side telemetry batched through a backend endpoint | APM auto-instrumentation alone; deny-list / regex redaction of logs; audit entries as `info` logs; a separate audit database fed by a transactional outbox; browser telemetry shipped straight to a Collector | Auto-instrumentation answers "why did this request fail" but not "why did this respondent give up", which is the question this domain actually has — and it cannot see decisions the client makes locally. Deny-list redaction fails open on every field added later, so a wrapper type makes a leak structurally impossible instead; the demo questionnaire collects medical conditions. An audit trail needs retention and integrity independent of logging-cost decisions; a restricted role makes append-only a database guarantee while keeping the audit write inside the publish transaction, where a separate database would place it outside and allow a publish with no audit record. The outbox that resolves that is the documented path to a standalone audit service, deferred rather than rejected. A public collector would be unauthenticated and could not apply the same attribute allowlist. | 2026-09-12 |

### 17.1 Alternatives considered in detail

Expanded notes on the options we weighed for decisions #1–#4, so the reasoning survives beyond the one-line table.

**Frontend / full-stack framing**

- *Next.js (unified frontend + backend).* Considered for fewer moving parts: one repo, one container, route handlers as a free API, NextAuth ecosystem. Rejected because its strengths (SSR, SEO, RSC streaming, auth integrations) don't apply to an internal admin tool and a respondent flow with auth out of scope, while its costs do — App Router / server components / caching semantics carry a learning curve, and the framework blurs the definition-vs-execution boundary that the brief explicitly grades. Domain logic would still need its own module structure, ORM, migrations and tests, so little is actually saved on the backend side.
- *Create React App / other React scaffolds.* Not viable; CRA is unmaintained. Vite is the current default and has the shallowest ramp.
- *Server-rendered admin (e.g. templates from Fastify).* Would reduce JS but make the respondent's dynamic next-question flow clunkier; a SPA is the natural fit for a stateful form.

**Backend framework**

- *NestJS.* Attractive because its module/DI structure makes the authoring / publishing / execution split very visible to a reviewer. Rejected for boilerplate volume and ramp time relative to the project size; we can achieve the same visibility with Fastify plugins/encapsulation and a deliberate folder layout.
- *FastAPI (Python).* Strong service ergonomics (Pydantic validation, auto OpenAPI). Rejected because a second language means API types are generated (openapi-typescript) instead of shared from a common package, and two toolchains complicate the one-command setup.
- *Express / Hono.* Express is the incumbent but lacks built-in schema validation and has a weaker plugin story; Hono is lightweight but its Node/OTel/pino ecosystem is thinner than Fastify's.

**Runtime**

- *Bun as server runtime.* Considered for speed and its built-in Postgres client. Rejected: the workload is I/O bound so runtime speed is not a lever; real scaling levers are pooling, indexing, caching published definitions, and read replicas. Bun runs Fastify through a Node-compat layer that can trip on plugins, pino transports and OpenTelemetry instrumentation — the wrong debugging to do in an interview timeline, and "straightforward to run" is graded. Bun remains an option as a package manager / test runner only, and Drizzle's `bun-sql` adapter keeps a later runtime swap cheap.

**Data access**

- *Prisma.* More batteries-included (schema DSL, generated client, Prisma Migrate) and arguably the most reviewer-friendly client. Rejected as heavier than needed and more abstracted from SQL; partitioning, `FOR UPDATE` locks and JSONB queries are more natural in Drizzle.
- *Raw driver only (`pg`, `postgres.js`, or `Bun.sql`).* Rejected because repeatable migrations and a reviewable, typed schema are explicit deliverables; a bare driver would mean hand-rolling both.
- *Other databases (SQLite, MongoDB).* SQLite would simplify local setup but weakens the scaling and concurrency story the brief asks us to defend. A document store fits the questionnaire definition JSON well but makes response history, transactions around publish, and relational integrity between versions and responses harder to model and explain. Postgres covers both with JSONB.

Decisions #6, #7 and #9 concern the questionnaire format; their alternatives are written up in
[[5-questionnaire-format#7. Alternatives considered]] rather than repeated here.

## 18. Open Questions

Ordered roughly by what blocks what.

1. **The v2 demo change.** Which single change version 2 of the seeded questionnaire makes. Rewording a prompt and relabelling an option both exercise the stable-id guarantee directly; adding an option changes the answer domain and is a weaker demonstration.
2. **Formatting subtypes for `text`** — email, phone, regex patterns. Deliberately pinned rather than rejected; we want these, just not before the vertical slice is complete. Also listed in [[#19. Future Work]].
3. **In-flight sessions at retirement.** The hard cutoff ships now ([[#8.1 Questionnaire lifecycle and retirement]]). Whether `cutoffMode: 'hard' | 'soft'` becomes a per-questionnaire setting is undecided. Also in [[3-scaling#8. Open questions]].
4. **Snapshot format support window.** How many past `formatVersion`s the loader commits to upgrading from, and what triggers dropping support for one.
5. **Pages / sections.** Deferred, not rejected — [[5-questionnaire-format#1. The model]] states the constraint any future design must respect.
6. **Checkpoint endpoint** — ship in the prototype or defer. Already tracked in [[3-scaling#8. Open questions]].
7. **Withholding unreachable questions** from the definition payload in sensitive deployments. Already tracked in [[3-scaling#8. Open questions]]; ties to HIPAA future work.

## 19. Future Work

*What we would improve next toward full production: multi-tenancy, security/HIPAA, localization, offline support, etc.*

- **Split the frontends.** Deploy the respondent questionnaire app and the admin portal separately; the questionnaire app is potentially hit much harder and benefits from a CDN, aggressive caching and edge rate limiting, while the admin portal stays behind auth. Keep them as separate entry points/packages from the start so this is a deploy change. See [[3-scaling#6. Future improvement: split the frontends]].
- Redis as cache and (separately) durable ingest queue, triggered by measured load. See [[3-scaling#3. Problem: response ingest vs. reads]] §3–5.
- An AI-assist system for initializing a questionnaire
- **Format subtypes for `text`** — email, phone and regex-pattern validation. Pinned deliberately rather than rejected; see [[#18. Open Questions]] §2.
- **Unit conversion for `number`.** Answers already carry the unit they were collected under ([[#5. Questionnaire Format]]), so converting between compatible units (cm/in, kg/lb) for display and analytics is additive rather than a migration.
- **Erasure on request (GDPR / HIPAA).** The stated exception to [[#3. Constraints]]: removing one respondent's data as an explicitly invoked, audited operation, including from snapshots' derived indexes and cold-storage partitions. Deliberately not a cascade delete.
- **Independently versioned question bank.** Drafts and a publish step on questions themselves, for authors who need to park half-finished edits. Additive over today's append-only model — see [[5-questionnaire-format#7. Alternatives considered]] §7.5.
- **Upgrade a draft to the latest question versions.** A per-question review action, so moving a questionnaire forward does not mean removing and re-adding items.
- **A/B testing whole questionnaires.** Noted during ideation; deferred as orthogonal to the versioning model — a published version is already the unit an experiment would assign against.
- **Standalone audit logging service.** Extract the audit trail behind a transactional outbox so it can be operated, backed up and access-controlled independently of the application database. The schema-and-role design shipping now (Decisions Log #13) is deliberately outbox-ready: audit writes go through a single repository function, and audit rows carry their own id and timestamp rather than borrowing the domain row's. See [[6-observability#5.1 Isolation — separate schema with a restricted role]].
- **Invariant monitoring and a synthetic canary.** Periodic gauges for orphaned answers, never-shown items and live snapshot format versions — drift that returns HTTP 200 and moves no existing signal — plus a canary completing the medical-condition demo questionnaire end to end, which is the only signal that proves the *workflow* works rather than that the processes are up. Cheap to build here because the demo questionnaire already exists. See [[6-observability#9. Correctness and invariant monitoring]].
- **Deploy and migration markers on dashboards.** Most incidents are change-caused, and "what changed at 14:02" is the first question in all of them.
