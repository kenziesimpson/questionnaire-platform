# Application Boundary — Detailed Design

> Detail doc for [[2-design-doc#9. API / Service Boundary]]. The design doc carries the condensed version; this is the full endpoint surface, the conventions, the access model and the reasoning behind them.
> Related: [[5-questionnaire-format]] (what crosses the boundary), [[2-design-doc#12. Database]] §12.1 (the storage split the boundary mirrors), [[3-scaling]] (load model), [[6-observability]] (the redaction rule that also applies to error bodies).

## 1. What the boundary is for

The brief asks for "a clear application or service boundary, such as an API, that separates questionnaire **definition** from questionnaire **execution**." It is one of the graded capabilities, and the easy way to fail it is to ship a URL prefix: `/api/admin/*` and `/api/run/*` handled by the same service layer over the same models, where the separation is a naming convention a reviewer has to take on trust.

So the boundary is defined here as **an artifact, not a route prefix**. There is exactly one object that crosses from definition to execution, the dependency runs one way, and the barrier is enforced in three places that are not the URL: the module graph, the type system, and the database grants. The routes then fall out of that, rather than being the thing itself.

This also makes the boundary *testable*. "Are the halves separate?" becomes a question with a mechanical answer — a lint rule and a database permission — instead of an architectural claim.

## 2. Three representations

The same questionnaire has three shapes over its life. Naming all three, and keeping each on one side of the line, is most of the design:

| Representation | Side | Mutable | Shape | Who may hold it |
| --- | --- | --- | --- | --- |
| `QuestionnaireDraft` | Definition | yes | Normalized rows. Items reference questions by `(questionId, questionVersion)`. May be incomplete or invalid. | Definition module only |
| **`PublishedDefinition`** | **crosses** | **never** | One self-contained JSONB document ([[5-questionnaire-format#3. Serialization]]). Question content embedded inline; no id needs resolving against another table. Carries `formatVersion`. | Both |
| `Session` + `Response` | Execution | session yes, responses no | `{ sessionId, questionnaireId, version, status, startedAt, submittedAt }` plus response rows pinned per [[2-design-doc#6. Versioning & Immutability]]. | Execution module only |

**The rule:** execution code only ever accepts a `PublishedDefinition`. It never sees a draft, never resolves a `questionId` against the question bank, never joins to an authoring table.

This is affordable only because of the storage decision already made (Decisions Log #7): the published snapshot is self-contained by construction. The snapshot was chosen for read performance and single-row immutability; that it also makes the definition/execution boundary a clean cut is the property being cashed in here. A normalized published form would have forced execution to read authoring tables to render anything, and the boundary would have been fiction.

The redundancy is the same redundancy §12.1 already defends. A published version cannot be disturbed by a later edit to the question it was built from — and, now, cannot be *reached* by the half of the system that does the editing.

### 2.1 What execution is structurally denied

Worth stating as a list, because each entry is a class of bug that cannot occur:

- It cannot read a draft, so it cannot serve unpublished content.
- It cannot resolve "the latest version of question X", so a question edit cannot change what an in-flight session renders.
- It cannot write to any definition table, so no execution path can mutate a published version.
- It cannot ask for "the current version of questionnaire Y" at all (§5.2), so version drift mid-session is unrepresentable rather than handled.

## 3. Enforcing the boundary below the type system

Types are the first layer and the weakest — they are compile-time and a cast defeats them. Two layers underneath, in the same spirit as the three-layer immutability enforcement (§6.4 of the format doc) and the telemetry boundary module ([[6-observability#3.1 Enforcement ladder]]).

### 3.1 Module encapsulation

Each half is an encapsulated Fastify plugin with its own route tree, schemas and repository layer. Fastify plugin encapsulation means decorators and hooks registered inside one are invisible to the other by default, so sharing is an explicit act rather than an ambient one.

No cross-imports, enforced by ESLint `no-restricted-imports` with zone rules: `modules/execution/**` may not import `modules/definition/**` or vice versa. Everything either side needs from the other goes through `@qp/shared`. This is the same enforcement pattern already chosen for the telemetry boundary, so it is one rule family rather than a new idea.

### 3.2 Database grants

The barrier that survives a refactor. Two roles, both distinct from the migration role that owns the schema:

| Role | `SELECT` | `INSERT` / `UPDATE` |
| --- | --- | --- |
| `qp_definition` | question bank, question versions, questionnaires, draft items, published versions, `version_question_index` | all of the above (subject to the immutability trigger on published rows) |
| `qp_execution` | published versions, `version_question_index`, questionnaires (for `closes_at`), sessions, responses | sessions, responses only |

`qp_execution` has no grant on any authoring table. `qp_definition` has **no grant on `response`** — the authoring surface is not a back door into answer data, which in this domain is medical history. Aggregate visibility for admins ("where do respondents give up") is a third, later surface with its own role reading the session record and domain events, never raw answers; see §10.

This is the same technique as the audit role ([[6-observability#5.1 Isolation — separate schema with a restricted role]]): make the guarantee something Postgres enforces rather than something the service layer promises. In one process that means two pools with two connection strings. When the halves split into two services, it is already the right shape and nothing changes.

### 3.3 What stays shared

`@qp/shared` is the only shared code, and it holds exactly two things:

1. **Wire types** — `PublishedDefinition` and its sub-types, request/response types for both APIs, the problem-details type.
2. **The rule engine** — one evaluator over `visibleWhen`, used by the client to render and by the server to validate on submit.

The rule engine is shared for a correctness reason, not a convenience one. The client decides what to show and the server decides what to accept; if those are two implementations, they drift, and the failure mode is a respondent being rejected for answering exactly what they were asked. One function, tested once ([[2-design-doc#15. Testing]]).

Note the engine takes a `PublishedDefinition` and answers, and returns visibility. It has no database access and no knowledge of drafts, so sharing it does not leak the boundary.

## 4. Definition API

Mounted at `/api/definition`. Every route requires an authenticated author (§7); in the prototype the hook is a stub that always passes.

### 4.1 Endpoints

| Method & path | Purpose | Success |
| --- | --- | --- |
| `GET /questions` | Question bank; latest version of each, `?includeArchived=` | `200` |
| `POST /questions` | Create a question (writes version 1) | `201` |
| `GET /questions/:questionId` | Latest version plus metadata | `200` |
| `GET /questions/:questionId/versions` | Version history (metadata only) | `200` |
| `GET /questions/:questionId/versions/:v` | One immutable question version | `200` |
| `POST /questions/:questionId/versions` | Save a revision — append-only, so saving is publishing (Decisions Log #13) | `201` |
| `POST /questions/:questionId/archive` | Hide from the bank; existing placements unaffected | `200` |
| `GET /questions/:questionId/usage` | Which published versions embed this question — reads `version_question_index` | `200` |
| `GET /questionnaires` | List with current version and `closesAt` | `200` |
| `POST /questionnaires` | Create; opens draft version 1 | `201` |
| `GET /questionnaires/:id/draft` | The working draft, normalized | `200` |
| `PUT /questionnaires/:id/draft` | Replace draft items, order and predicates | `200` |
| `POST /questionnaires/:id/draft/validate` | Dry run of the publish checks — no writes | `200` |
| `POST /questionnaires/:id/publish` | Promote draft to version *N* in one transaction | `201` |
| `POST /questionnaires/:id/draft` | Open the next draft as a copy of the latest published version | `201` |
| `GET /questionnaires/:id/versions` | **Version history** — metadata only, no snapshots | `200` |
| `GET /questionnaires/:id/versions/:v` | One published snapshot, verbatim | `200` |
| `PUT /questionnaires/:id/closes-at` | Set, reschedule or clear `closesAt` | `200` |

`PUT /draft` replaces the whole draft rather than patching items individually. The draft is small, it is edited by one author in one screen, and whole-document replacement makes ordering and predicate edits atomic — a reorder is not a sequence of index writes that can half-apply. Concurrency is handled with an `If-Match` ETag over the draft's `updatedAt`, returning `409 questionnaire/draft-stale` rather than silently clobbering a second tab.

`POST /draft/validate` exists so the authoring UI can show satisfiability and reachability problems ([[5-questionnaire-format#5. Publish-time validation]]) while editing, using exactly the code path publish uses. Not a second implementation of the rules — the publish handler calls the same function and refuses on the same result.

### 4.2 Reading version history — this is a definition-side concern

Version history, snapshot inspection and "which questionnaires use this question" all live here, on `GET /questionnaires/:id/versions` and friends. Two notes on why, since the shape of §5.2 makes it a fair question:

**Why not just query the database for that view.** The admin UI is a browser app, so "query the DB" would mean either a generic query endpoint (an unbounded surface with no access model) or `psql`, which is not a usable admin UI and the brief grades one. More to the point, the frontends are already planned to split ([[3-scaling#6. Future improvement: split the frontends]]), and the admin portal is a deployable client like any other — anything it needs is an API contract, not an implementation detail it can reach around. Direct DB reads from a UI are also exactly what the §3.2 grants exist to prevent; carving an exception for reads would concede the barrier.

**Why this does not contradict §5.2.** The same snapshot row is readable from both halves, through two endpoints with different contracts, and the duplication is deliberate:

| | Definition read | Execution read |
| --- | --- | --- |
| Addressed by | `(questionnaireId, version)` — any version, explicitly | `sessionId` — only the version that session pinned |
| Audience | Authenticated author | Anonymous respondent |
| Includes retired / superseded versions | Yes | Only if the session pinned one |
| Purpose | Inspection, audit, diffing, support | Rendering the flow |

Collapsing these into one endpoint to avoid writing the handler twice is what would break the boundary: it would give the respondent surface a way to name an arbitrary version, and it would give the two audiences one access model when they need two. The handler body is a few lines either side of a different lookup; the contract is the part that matters.

Version history is metadata only — `version`, `publishedAt`, `publishedBy`, `itemCount`, `formatVersion` — because the history screen is a list and snapshots are the largest documents in the system. Fetching a snapshot is the explicit second click.

### 4.3 Publish and retire

`POST /publish` is the single most consequential write in the system and runs as one transaction: read the draft, run the validations, serialize the snapshot, promote the draft row to version *N*, write `version_question_index` rows, write the audit row ([[2-design-doc#12. Database]]). It refuses with `422 draft/invalid` carrying the per-item validation failures, and `409 version/immutable` can only ever surface from the database trigger — if the API ever returns it, that is a bug worth seeing rather than a race worth hiding.

Retirement is a `closesAt` write, not a state machine (§8.1 of the design doc). Clearing it is allowed and is how a premature retirement is undone; the audit row records both.

## 5. Execution API

Mounted at `/api/run`. Unauthenticated (§7).

### 5.1 Endpoints

| Method & path | Purpose | Success |
| --- | --- | --- |
| `POST /sessions` | Start: resolve the current published version, pin it, create the session | `201 { session, definition }` |
| `GET /sessions/:sessionId` | Resume: the session and **its pinned** definition | `200 { session, definition }` |
| `PUT /sessions/:sessionId/progress` | Optional debounced checkpoint of partial answers — scope call, §10 | `204` |
| `POST /sessions/:sessionId/submit` | Validate and persist responses; terminal | `200 { receipt }` |

Four routes. The surface is small because the execution model already decided the client fetches the whole definition once and evaluates branching locally (Decisions Log, execution model): there is no "next question" round trip to design, because the next question is a client-side function of a document the client already holds.

`POST /sessions` returns the definition in the same response rather than making the client fetch it — the common path is one round trip, and the version the session pinned and the version the client renders are the same bytes by construction rather than by a second lookup that could resolve differently.

`GET /sessions/:sessionId` returns the definition again on resume. That is a few KB re-sent on a rare operation, and the server cost is near zero because compiled snapshots are held in an in-process cache that never needs invalidating ([[3-scaling#4. Problem: hot definition reads]]). If resume payload size ever matters, splitting it to a session-scoped `GET /sessions/:sessionId/definition` — immutably cacheable, still impossible to reach without a session — is an additive change.

### 5.2 There is no unpinned definition read

The execution API has no route that takes a `questionnaireId` and returns a definition. Fetching a definition is inseparable from starting a session, version resolution happens exactly once, server-side, at session creation, and every later read returns the pinned version.

The consequence is the one the brief asks us to defend: **what happens to in-flight sessions when a questionnaire is republished.** The answer is that the execution API has no vocabulary for asking about "the current version", so a session cannot drift onto a newer one. This is the same move as the flat item list and forward-only predicates (Decisions Log #6, #9) — the failure mode is unrepresentable rather than handled, which is a smaller thing to test and a smaller thing to get wrong later.

It also means a new publish is invisible to every session already running, and visible to every session started afterwards, with no coordination, no polling and no migration of in-flight state.

The cost is that admin preview of "what a respondent sees right now" is not a respondent-API call. It is `GET /definition/questionnaires/:id/versions/:v` (§4.2), rendered by the admin app through the same shared renderer. Which is the correct place for it: previewing is an authoring activity.

**How the respondent lands.** The respondent app is entered at `/q/:questionnaireId` and immediately `POST /sessions`. A closed questionnaire returns `409 questionnaire/closed` and the app renders the "responses closed" page (§8.1 of the design doc); a questionnaire that has never been published returns `404` — deliberately indistinguishable from one that does not exist, so the public surface cannot be used to enumerate drafts.

### 5.3 Session lifecycle

`in_progress → submitted` and nothing else. Abandonment is not a state, it is the absence of a submit — inferred from the session record for analytics ([[6-observability#4. Domain events]]) rather than written by a process that has to decide when to give up.

Resume works because the session id is durable and the session pins its version: the browser holds partial answers ([[3-scaling#2. Load model (what actually hits the backend)]]), the server holds the pin. The respondent app persists the session id locally and the resume link is a capability URL (§7).

### 5.4 Submit: authority, validation, idempotency

Submit is the single write on the execution path and the server is the authority. It re-evaluates the reachable path with the shared rule engine against the submitted answers and the pinned definition, and accepts only if:

- every item it computes as visible-and-required has an answer;
- every submitted answer belongs to an item that is visible on the computed path — an answer to a skipped item is a rejection, not a silently ignored row;
- every value satisfies its question version's constraints (type, option ids, `maxLength`, date bounds, `{ value, unit }`);
- `closesAt` has not passed.

All-or-nothing in one transaction. Partial acceptance would leave a session in a state the model does not have.

**Idempotency uses the session as the key.** No separate idempotency-key table: the session *is* the natural unit, and a duplicate submit is always a retry of the same session. Submit takes `SELECT ... FOR UPDATE` on the session row, and if it is already `submitted`, compares a `responseDigest` (a hash over canonicalized answers) stored at first submit — identical digest replays the original receipt with `200`, a different digest returns `409 session/already-submitted`. A network retry is safe; a genuine second submission of different answers is an error rather than a silent overwrite of someone's medical history.

This is cheaper than an `Idempotency-Key` header and strictly more useful, because it also catches the two-tabs case that a client-generated key would not.

### 5.5 Error bodies must not echo answers

The redaction rule from [[6-observability#3. Respondent answers must never enter telemetry]] applies to responses as well as telemetry, and error bodies are the easy place to lose it — the natural phrasing of a validation message is "`1985-13-45` is not a valid date".

A `422` says which item failed and which rule it failed, never what was entered: `{ "itemId": "itm_03", "code": "date/out-of-range" }`. The client already holds the answer and can render a message against it locally. Submitted values appear in exactly one place, the `response` table, and nowhere else in the system.

## 6. Conventions

### 6.1 Error format — RFC 9457 problem details

`application/problem+json` on every non-2xx, from both halves:

```json
{
  "type": "https://qp.example/problems/version-immutable",
  "title": "Published versions cannot be modified",
  "status": 409,
  "detail": "Version 2 of questionnaire qnr_intake was published on 2026-09-13.",
  "instance": "/api/definition/questionnaires/qnr_intake/versions/2"
}
```

A standard beats a bespoke envelope here for one reason worth more than familiarity: it already specifies how to add fields. Validation failures carry `errors: [{ pointer, code }]`, submit failures carry `items: [{ itemId, code }]`, and both are extension members rather than a second error shape.

`type` slugs come from a closed union in `@qp/shared`, so they are exhaustive on the client and cannot be invented at a call site:

| Slug | Status | Meaning |
| --- | --- | --- |
| `request/invalid` | 400 | Failed schema validation |
| `resource/not-found` | 404 | Unknown id, or a draft viewed from the public surface |
| `draft/invalid` | 422 | Publish-time validation failed |
| `draft/stale` | 409 | `If-Match` mismatch on a draft write |
| `questionnaire/draft-exists` | 409 | A draft is already open |
| `version/immutable` | 409 | Attempted write to a published version |
| `questionnaire/closed` | 409 | Past `closesAt` |
| `session/already-submitted` | 409 | Submit with a different digest |
| `submission/invalid` | 422 | Required, unreachable or constraint-violating answers |
| `internal` | 500 | Unhandled; `detail` is a correlation id, never a stack |

### 6.2 Status codes

The split that keeps `409` and `422` from becoming interchangeable: **`409` means the request conflicts with current state** (something else already happened), **`422` means the document is well-formed but violates a domain rule** (nothing about the current state would make it valid). `400` is reserved for schema failures, so a `400` is always a client bug and never a user mistake — which makes it a usable alerting signal.

`500` carries a correlation id equal to the trace id, so a user-reported failure joins straight to its trace ([[6-observability#2.1 Traces]]).

### 6.3 Input validation

One TypeBox schema per route, registered with Fastify, which validates and coerces before the handler runs — one of the reasons Fastify was chosen (Decisions Log #2). The schema is the source of truth and the TypeScript type is inferred from it, so a route's declared contract and its handler's types cannot disagree. Shared request/response types live in `@qp/shared` and both halves import them; the frontend imports the same types, so the wire contract is checked at compile time on both ends without a codegen step.

Schema validation covers shape. Domain validation — satisfiability, reachability, `closesAt` — is the handler's, because it needs the database.

### 6.4 Caching

`GET /definition/questionnaires/:id/versions/:v` returns an immutable document and is served with `ETag: "<questionnaireId>:<version>:<formatVersion>"` and `Cache-Control: private, max-age=31536000, immutable`. `private` because definitions are not public content and the admin surface will be authenticated.

Draft reads are `no-store`. Session reads are `no-store` — the session part changes and the definition rides along with it.

### 6.5 Versioning the API itself

Routes are unversioned in the prototype. The wire contract that actually evolves independently — the snapshot — already carries its own `formatVersion` and is upgraded in memory at read time ([[5-questionnaire-format#6.5 Snapshot format version]]), which is the versioning that matters for stored data. If the HTTP surface ever needs to break compatibility, the mount point takes a prefix; nothing in this design depends on the path.

## 7. Access model and data barriers

Auth is out of scope (design doc §4), but the model is stated now so that adding it is a hook and a middleware, not a redesign.

**Two principals.**

| | Author | Respondent |
| --- | --- | --- |
| Surface | `/api/definition/*` | `/api/run/*` |
| Identity | Authenticated user from an upstream IdP (OIDC assumed) | Anonymous |
| Enforcement | One `preHandler` hook on the definition plugin — all routes, reads included | None; the session id is the credential |
| Prototype stub | Hook present, always passes | n/a |

Applying the hook to the whole plugin rather than per route is deliberate: a new definition endpoint is protected by default, and forgetting is not one of the available mistakes.

**Session ids are bearer capabilities.** With no respondent accounts, holding a session id *is* authorization to read and submit that session. Three consequences, all cheap now and expensive to retrofit:

- Session ids are cryptographically random (UUIDv4, or v7 where ordering helps indexing — never sequential), so they are not enumerable.
- The resume link is a capability URL, so the respondent app sets `Referrer-Policy: no-referrer` to keep it out of `Referer` headers on any outbound link, and the id is never placed in a query string where it would land in access logs.
- Session ids appear in traces and logs as ids (they already do — [[6-observability#2.1 Traces]]) but never in a metric label, and never in anything rendered to another respondent.

With real auth, the respondent surface gains an owner check and the capability property becomes a fallback rather than the whole model.

**Data barriers** are §3.2: execution cannot read authoring tables, and the authoring surface cannot read `response`. The second is the one a reviewer is less likely to expect and the more important of the two — "who can read the answers" has a smaller answer than "who is an admin".

## 8. Deployment topology

### 8.1 Now — two plugins, one process

Both halves register as encapsulated Fastify plugins in a single backend container, mounted at `/api/definition` and `/api/run`, with two connection pools bound to the two roles in §3.2. The `frontend` nginx proxies `/api/*` to it as today ([[2-design-doc#13. Deployment]]); no compose change.

One process is right for the prototype: one container to run, one process to debug, one log stream, and `docker compose up` stays one command. The boundary being enforced by module graph, types and grants rather than by a network hop means the split is a deployment decision, not an architectural one — and can be deferred without being compromised.

### 8.2 Later — two services

Splitting is a real improvement, mostly for security. Recorded now so it is a considered deferral rather than an omission:

- **Network exposure.** The execution API is internet-facing and unauthenticated; the definition API is an internal admin tool. As separate services the authoring API need not be routable from the public internet at all — an ingress rule and a network policy, which is a far stronger statement than an auth hook in a process that also serves anonymous traffic.
- **Blast radius.** A vulnerability reached through the respondent surface — a dependency CVE, an SSRF, a deserialization bug — currently lands in a process that also holds the `qp_definition` pool. Split, it lands in a process whose database role cannot touch authoring tables and whose network cannot reach the admin service. The §3.2 grants already limit what it could do; separate processes make that a property of the deployment rather than of a correctly-chosen pool.
- **Attack surface per surface.** The public service stops shipping authoring code entirely, so admin routes cannot be reached by path confusion, a proxy misconfiguration, or a future plugin registered at the wrong mount point.
- **Scaling.** Respondent traffic is orders of magnitude higher than authoring traffic ([[3-scaling#2. Load model (what actually hits the backend)]]). Separate replica counts and separate pool sizing follow, and the execution service caches snapshots hard while the authoring service caches nothing.
- **Deploy cadence and risk.** Authoring changes stop restarting the respondent path. Publishing is the highest-consequence write in the system; not coupling its release to the surface collecting medical answers is worth something on its own.
- **Auditability.** "Which service wrote this" becomes a deployment fact rather than a code-path fact.

The honest costs: two images, two deployments and two pipelines; two places to wire observability; and publish-then-serve becomes eventually consistent across a cache boundary if the execution service caches snapshots — benign, because snapshots are immutable and only "which version is current" can be stale, bounded by the cache TTL.

### 8.3 What we do now to keep the split cheap

The split should be a deployment change, so nothing in the prototype is allowed to assume co-location:

- No cross-imports between the halves (§3.1), so neither can develop a compile-time dependency on the other.
- No shared in-process state between them — no shared cache object, no shared decorator, no in-memory event bus. Anything either needs from the other is in Postgres or in `@qp/shared`.
- Separate pools on separate roles from day one (§3.2), so the connection topology is already two-service shaped.
- Each half owns its own repository module; neither calls the other's functions, even where the query would be identical.
- Configuration already env-var only, so two services need two env files and no code change.
- The observability setup is per-plugin-instrumented ([[6-observability#2. Signal taxonomy]]), so split services produce the same spans under a different `service.name`.

The test for whether this has been maintained: could the execution plugin be moved to its own package, given only `@qp/shared` and the `qp_execution` role, and still compile? If not, something has leaked.

## 9. Alternatives considered

### 9.1 One API over a shared service layer

The default: `/api/admin` and `/api/run` as route groups over one set of models and repositories. Rejected because the separation would exist only in the URL — a reviewer would have to take the boundary on trust, and there would be nothing preventing an execution handler from reading a draft next month. The brief grades the boundary explicitly, and a boundary that cannot be violated is a better answer than one that merely has not been.

### 9.2 Execution reads the normalized authoring tables

Drop the snapshot from the boundary and have the execution side assemble definitions from questionnaire, item, question-version and option rows. Rejected on three counts: it puts a four-way join on the hottest read path ([[3-scaling#2. Load model (what actually hits the backend)]]); it makes immutability something execution must respect rather than something it cannot violate; and it requires execution to resolve question identity, which reintroduces exactly the version-drift class of bug that pinning exists to remove. Already rejected for storage reasons in Decisions Log #7; the boundary makes it worse, not better.

### 9.3 A public unpinned definition read

`GET /api/run/questionnaires/:id/current`, with session creation separate. Genuinely tempting: it caches beautifully behind a CDN, it makes the admin preview trivial, and it is what most APIs of this shape do. Rejected because it reintroduces a window in which the client renders version *N* and the session pins *N+1*, and that window is precisely the in-flight-republish problem the brief asks us to defend. Handling it would mean the client sending its version and the server reconciling — machinery that exists only because the endpoint exists. The CDN argument is also weaker than it looks: the document is a few KB, held in an in-process cache, and fetched once per session.

### 9.4 Separate DB grants deemed overkill for a prototype

Considered running one role and relying on the module boundary. Rejected because the grants are the cheapest layer here — a few `GRANT` statements in a migration — and they are the only layer that survives a refactor, a careless import, or an agent-written handler. Same reasoning as the audit role, which is already in the design for the same reason.

### 9.5 tRPC, GraphQL, or OpenAPI codegen

tRPC gives end-to-end types with no schema duplication, but it couples the client to the server's TypeScript and makes the API a function call surface rather than an artifact a reviewer can read, curl, or point a second client at — a poor fit when "a clear service boundary" is the graded deliverable. GraphQL solves over-fetching we do not have; the execution read is deliberately "the whole document, once". OpenAPI codegen would be the right answer across a language boundary, but both ends are TypeScript in one repo, so a shared package gives the same safety with no generation step. Fastify can still emit an OpenAPI document from the TypeBox schemas for documentation, which we get essentially free.

### 9.6 Two processes from day one

Rejected for prototype ergonomics — two containers, two log streams and a second pipeline, bought before any of the benefits in §8.2 apply, and against "one command to run" which is explicitly graded. The design keeps the split cheap (§8.3) instead of taking it early.

## 10. Open questions

1. **Checkpoint endpoint.** Whether `PUT /sessions/:id/progress` ships in the prototype. It is the only route here that is not load-bearing: partial answers already live in the browser, and its value is operational (seeing *where* an abandoned session stopped, not merely that it stopped) plus cross-device resume. Cost is a write path on the hot side and a partial-answer store with its own redaction surface. Also tracked in [[2-design-doc#18. Open Questions]] and [[3-scaling#8. Open questions]].
2. **Admin reporting surface.** §3.2 denies the definition role any read on `response`, which is correct, and leaves "how do admins see aggregate results" unanswered. Expected shape is a third read-only surface with its own role over the session record and domain events, with raw answers behind an explicit, audited export. Not designed yet.
3. **Version diffing.** `GET /versions/:a/diff/:b` would make "what changed in v2" a first-class answer and is directly useful for the mandatory v2 demo. Deferred as additive — both snapshots are already retrievable and the admin app can diff client-side.
4. **Rate limiting on the execution surface.** Unauthenticated `POST /sessions` is trivially abusable. `@fastify/rate-limit` is a small addition; whether it belongs in the prototype or is stated as an edge concern is open, and it interacts with where the split in §8.2 puts the public ingress.
