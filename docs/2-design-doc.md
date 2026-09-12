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

- 

## 4. Out of Scope

*Capabilities we are intentionally deferring, with a one-line note on how each would be addressed in production. (The brief asks us to make these explicit.)*

| Deferred capability | Why deferred | Production approach |
| --- | --- | --- |
| Authentication / authorization | Not required to demonstrate the core workflow; would consume time better spent on versioning and branching. | Define the access *model* and data barriers now (admin vs. respondent, session ownership) so auth can be slotted in. Assume an upstream identity provider (OIDC) and enforce roles in a Fastify hook. |

## 5. Questionnaire Format

*How a questionnaire, its questions, and its rules are represented.*

### 5.1 Question types
*Supported response types (text, single choice, multiple choice, number, date, yes/no) and per-type validation/limits.*

### 5.2 Structure & ordering
*Flat list vs. pages/sections; how order is expressed; required-ness (including any nesting).*

### 5.3 Serialization
*Wire/storage format for a questionnaire definition (e.g. JSON schema). Include an example.*

## 6. Versioning & Immutability

*How questions and questionnaires are versioned; what "published" locks; how responses pin to the version they were collected against.*

- *Version identity (per question, per questionnaire, or both?)*
- *What edits create a new version vs. a draft?*
- *How the "change one question without changing meaning of prior responses" demo works.*
- *Where immutability is enforced (DB constraints, service layer, tests).*

## 7. Branching Rules

*Representation, validation, and execution of conditional paths.*

- *Rule model: conditions over one or more prior responses; operators supported.*
- *Evaluation: how "next applicable question" is computed.*
- *Safety: cycle and deadlock prevention, unreachable questions, validation at publish time.*

## 8. Sessions & Responses

*Execution-side data and behavior.*

- *Session lifecycle (start → in-progress → submitted) and resume.*
- *Response storage and validation (required, value constraints).*
- *Behavior when a questionnaire is republished while sessions are in flight.*
- *Idempotency / duplicate submission handling.*

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
- *Indexing strategy; audit logging approach.*

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

**Stub — direction agreed, details to fill in.**

- **OpenTelemetry** as the single instrumentation standard for traces, metrics and logs. Backend uses the Fastify OTel plugin (`@fastify/otel`) — one of the reasons Fastify was chosen (Decisions Log #2).
- **Logs correlated across frontend and backend.** The browser propagates W3C trace context (`traceparent`) on API calls so a respondent-side event and the backend request it triggered share a trace id; frontend logs/errors are shipped with the same ids so a single session can be followed end to end.
- *Log structure (requests, dependencies, traces, exceptions) — decide fields and levels.*
- *Session id and questionnaire version as standard attributes on every span/log on the execution path, so a failed request or stuck session can be traced.*
- *Collector/exporter setup for local (compose) vs. hosted; first-priority metrics, alerts, backups and SLOs.*

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
| Operations |  |

## 17. Decisions Log

*Each decision with alternatives considered and why they were rejected. Append as decisions are made.*

| # | Decision | Alternatives considered | Rationale | Date |
| --- | --- | --- | --- | --- |
| 1 | Frontend: React + TypeScript via Vite, as an SPA with a separate backend | Next.js (unified FE/BE) | Next's strengths (SSR, SEO, auth ecosystem) don't apply to an admin tool / respondent flow with auth out of scope, while its App Router complexity does. The brief grades a clear definition-vs-execution service boundary and separation of concerns; a separate backend makes that boundary architecturally obvious instead of something a reviewer must trust. Vite is the current standard for React SPAs. | 2026-09-12 |
| 2 | Backend framework: Fastify | NestJS; FastAPI (Python) | Lightweight, built-in schema validation, `@fastify/otel` plugin for observability later. Nest adds boilerplate/DI ramp; FastAPI would mean two languages and generated rather than shared API types. | 2026-09-12 |
| 3 | Runtime: Node LTS (Bun optional for tooling only) | Bun as server runtime | Workload is I/O bound so runtime speed is not the bottleneck; scaling levers are pooling, indexing, caching, replicas. Bun's Node-compat layer still carries risk with Fastify plugins, pino transports and OTel instrumentation, and "straightforward to run" is graded. | 2026-09-12 |
| 4 | Data access: Drizzle ORM + `pg` driver + drizzle-kit migrations on PostgreSQL | Prisma; raw driver only (`pg` / `Bun.sql`) | Repeatable migrations and a reviewable schema are deliverables, so a raw driver is insufficient. Drizzle is SQL-close (partitioning, JSONB, row locks are natural), emits committed SQL migrations, and is driver-swappable. Prisma is heavier and abstracts more of the SQL. | 2026-09-12 |
| 5 | Deployment: separate frontend (nginx), backend and Postgres containers via Docker Compose; dedicated one-shot migrate/seed service; dev-only compose override with polling file watch; Kubernetes with the same split long-term | Single container serving SPA from backend; migrations at backend startup; manual migrations; Redis sidecar from day one | Three-way split mirrors the graded separation of concerns and is the same topology k8s will use. nginx proxy stands in for the production ingress and keeps the app single-origin. Dedicated migrate service gives deterministic boot order and survives multiple replicas. Polling watch chosen up front because bind-mount events on macOS are unreliable. Redis deferred until a concrete need. | 2026-09-12 |

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

## 18. Open Questions

- 

## 19. Future Work

*What we would improve next toward full production: multi-tenancy, security/HIPAA, localization, offline support, etc.*

- **Split the frontends.** Deploy the respondent questionnaire app and the admin portal separately; the questionnaire app is potentially hit much harder and benefits from a CDN, aggressive caching and edge rate limiting, while the admin portal stays behind auth. Keep them as separate entry points/packages from the start so this is a deploy change. See [[3-scaling#6. Future improvement: split the frontends]].
- Redis as cache and (separately) durable ingest queue, triggered by measured load. See [[3-scaling#3. Problem: response ingest vs. reads]] §3–5.
- 
