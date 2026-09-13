---
name: questionnaire-assignment
description: Requirements, review rubric, and design constraints for the Dynamic Questionnaire Platform interview assignment. Use whenever designing, implementing, testing, or documenting any part of this project so the work stays aligned with what the reviewers are looking for.
---

# Dynamic Questionnaire Platform — Assignment Skill

This project is a working, production-quality prototype of a dynamic questionnaire
platform. Use this skill as the source of truth for scope and quality bar. The full
brief lives in the attached Claude Project doc `Questionnaire_Platform_Interview_Assignment.docx`;
working docs are in `docs/` (see **Project docs** below).

## The one-line goal

An administrator can create and **version** questionnaires and questions, define
**conditional paths** based on prior responses, and a respondent can complete the
**correct flow** end to end. It must be runnable and demonstrable — not just a design.
Technology is free choice. Prefer a coherent vertical slice; document anything deferred.

## Required capabilities (checklist)

- [ ] Questionnaires: create, edit, view, **publish**, **retire**.
- [ ] Reusable questions with response types: text, single choice, multiple choice, number, date, yes/no.
- [ ] Versioning of questions AND questionnaires. A published version is **immutable**; historical responses keep the version they were collected against.
- [ ] Question ordering plus conditional branching rules that can depend on **one or more** previous responses.
- [ ] Respondent rendering that dynamically determines the next applicable question.
- [ ] Validation of required responses and response values.
- [ ] Persisted sessions and submitted responses; respondents can **resume** an incomplete session.
- [ ] Usable admin UI and usable respondent UI (simple is fine; the critical workflow must work end to end).
- [ ] A clear service/API boundary separating **questionnaire definition** (authoring/publishing) from **questionnaire execution** (sessions/responses).

## Mandatory branching demo

Ship a seeded questionnaire that does exactly this:

1. Ask whether the respondent has a medical condition (yes/no).
2. If **yes** → ask which condition, and when it was diagnosed (date).
3. If **no** → skip those and continue to the next common question.
4. Publish a **second version** that changes one question **without changing the meaning of responses already collected** under version one.

Automated tests should cover this scenario explicitly.

## Production-quality bar

- Clear domain model and DB schema with repeatable migrations / one-shot initialization.
- Well-defined APIs: input validation, useful error messages, consistent status handling.
- Automated tests on important domain behavior — **versioning and conditional navigation above all**.
- Separation of concerns: authoring, publishing, execution, response storage.
- Useful logging and enough operational visibility to troubleshoot a failed request or session.
- Reproducible local setup — ideally containers or a single command.

## Deliverables

1. Source code for the app and any supporting services.
2. README: setup, test commands, and steps to demo the primary workflow.
3. Concise architecture overview: major components, data model, request flow.
4. Record of key assumptions and design decisions, including alternatives considered and why they were rejected.
5. Short "what I'd improve next toward full production" section.

## Be ready to discuss (design defense)

- Versioning implementation and immutability guarantees for published questionnaires.
- Branching rule representation, validation, and execution — including **cycle and deadlock prevention**.
- What happens to **in-flight sessions when a questionnaire is republished**.
- Transaction management, concurrency control, and prototype tradeoffs.
- Future enhancements: multi-tenancy, security/HIPAA, localization, offline support.

## Scale considerations (answer concretely, not generically)

| Area | Must address |
| --- | --- |
| Read traffic | Keeping delivery + rule evaluation fast under high concurrency |
| Data growth | Indexing, partitioning, archiving a large response history |
| Reliability | Retries, duplicate submissions, partial failures, recovery |
| Change control | Schema migrations and releases that preserve published questionnaires and responses |
| Operations | First-priority metrics, logs, traces, alerts, backups, SLOs |

## Review rubric

Work is judged on: **working behavior** (end-to-end authoring → publishing → branching → response),
**engineering quality** (understandable, tested, maintainable, easy to run), **domain design**
(versioning, rules, sessions, responses modeled clearly), **decision quality** (explicit,
technically grounded tradeoffs), **production thinking** (security, reliability, observability,
deployment, change), and **communication** (can explain, demo, and handle alternative scenarios).

## Project docs (read these before making changes)

The design doc is the **index, not the encyclopedia**: it carries a condensed version of every decision, and any topic deep enough to need its own doc gets one. See **Working conventions** below.

- [[2-design-doc]] — the design doc. Condensed sections, plus the canonical [[2-design-doc#17. Decisions Log]] and [[2-design-doc#18. Open Questions]]. Italic prompts mark unfilled sections.
- [[5-questionnaire-format]] — **detailed** design for questionnaire format, branching rules, publish-time validation and questionnaire-level versioning; the depth behind design-doc §5–§7. Its §9 keeps the original ideation as an appendix.
- [[7-application-boundary]] — **detailed** design for the definition/execution boundary: the three representations, both endpoint surfaces, error and status conventions, access model and data barriers, deployment topology; the depth behind design-doc §9 and §8.
- [[9-database-schema]] — **detailed** design for the physical schema: tables, constraints, the triggers and grants that carry the invariants, concurrency control, partitioning, indexing and migration mechanics; the depth behind design-doc §12.
- [[8-testing]] — **detailed** design for the test strategy: the four layers, Testcontainers Postgres, the graded coverage list and the test-case enumeration; the depth behind design-doc §15.
- [[3-scaling]] — scaling constraints, load model, and ordered levers (each with a trigger). Redis lives here, not in the prototype.
- [[4-implementation-plan]] — checkbox list of open decisions and build tasks; tick items as they land.
- [[1-ideation]] — original brainstorm; superseded where the design doc disagrees.

Sibling skills in `.claude/skills/`: **database** (schema invariants, roles, migration mechanics and verified Postgres traps — load before touching schema, migrations, repositories or seeds).

## Decisions made so far (don't relitigate without reason)

- **Stack:** React + TypeScript via Vite (plain SPA); Fastify on Node LTS; PostgreSQL via Drizzle ORM + `pg` driver, `drizzle-kit` SQL migrations; TypeScript throughout with a shared workspace package for API types and the rule engine.
- **Deployment:** separate `frontend` (nginx serving the build, reverse-proxying `/api` as a stand-in for a production ingress), `backend`, `migrate` (one-shot migrate + seed, gates backend) and `db` containers in Docker Compose. `docker-compose.override.yml` gives Vite HMR / `tsx watch` locally with polling file-watch enabled up front. Kubernetes long-term with the same split.
- **Auth:** out of scope; the access *model* and data barriers must still be written down.
- **Execution model:** client receives the whole published definition once per session and evaluates branching locally with the shared rule engine; partial answers live in the browser; the server keeps a small **session record** (pins the version, makes submit idempotent, shows where respondents abandon); submit is the single write; the **server recomputes the reachable path on submit and is the authority**. Optional debounced checkpoint endpoint is a scope call.
- **Versioning stance:** a session is pinned to a version at start and keeps it; new sessions get the latest published version; no client polling for updates.
- **Questionnaire format:** a version is a **flat ordered list of items**. Order is the list index; there are no edges between questions, so branches converge automatically. Each item carries `required` and an optional `visibleWhen` predicate — both placement concerns, never on the reusable question. Six response types, with `yes_no` as sugar over `single_choice` on reserved `yes` / `no` option ids. Option ids and answer units are stable across question versions. Detail in [[5-questionnaire-format]].
- **Branching:** a single level of `all` / `any` over conditions **typed per response type**, so invalid comparisons are unrepresentable rather than a runtime error class. Predicates may reference only earlier questions, which makes cycles and deadlock unrepresentable rather than detected. A condition on a question that was not shown is `false` for every operator. Publish-time validation covers forward references, exact satisfiability by domain intersection, and referential integrity.
- **Definition storage:** normalized rows for authoring; one **immutable JSONB snapshot per published version**, written in the publish transaction. Snapshots carry a `formatVersion` and are upgraded in memory at read time — stored bytes are never rewritten. A derived `version_question_index` restores reverse lookups.
- **Publishing:** promotes the draft row in place to version N; at most one draft per questionnaire, enforced by a partial unique index. Immutability enforced in three layers — DB trigger, API `409`, and a test that bypasses the API to hit the database directly.
- **Retirement:** one nullable `closes_at` covers both ongoing and scheduled-close questionnaires. Hard cutoff for now: both starting and submitting are rejected past the date, and the respondent app renders a "responses closed" page.
- **Question versioning:** questions are **append-only** — no draft state on the bank, every save writes a new immutable `question_version` row, so saving is publishing. A stable `questionId` carries identity across revisions; a questionnaire item **pins the question version at add time** and keeps it. Saving is an explicit action (closing the edit dialog), so one save is one version. No "upgrade to latest" action yet.
- **Responses store** `questionId` (what you aggregate on), `questionVersion` (what you render with), the questionnaire version, and option ids or `{ value, unit }`. Prompt and label text are not copied onto responses — the snapshot holds those.
- **Nothing is deleted; things are hidden.** Questionnaires retire, questions archive, question versions append, snapshots and responses are immutable. Apply this by default to any new entity's lifecycle. The one exception is erasure on request (GDPR/HIPAA), which is a separate audited capability, not normal operation.
- **API boundary:** the boundary is an **artifact, not a route prefix**. Exactly one object crosses it — the immutable `PublishedDefinition` snapshot — and the dependency runs one way; execution never reads a draft, resolves a `questionId`, or joins to an authoring table. Enforced in three layers: encapsulated Fastify plugins with no cross-imports (ESLint zone rule), wire types in `@qp/shared`, and two database roles (`qp_execution` has no grant on authoring tables; `qp_definition` has **no grant on `response`**). `/api/definition/*` owns bank, drafts, publish, retire and version history; `/api/run/*` is four routes and has **no unpinned definition read**, so mid-session version drift is unrepresentable. RFC 9457 `problem+json`, `400` schema-only / `409` state conflict / `422` domain-invalid, and error bodies never echo a submitted answer. Submit is server-authoritative, all-or-nothing, idempotent on the session via an answer digest. Two plugins in one process now; splitting into two services is a deployment change, kept cheap deliberately. Detail in [[7-application-boundary]].
- **Database schema:** three schemas — `definition`, `execution`, `audit`. Four invariants live in the data layer: a draft is structurally unreferenceable (`version IS NULL` while draft, so composite FKs from `NOT NULL` columns match only published rows); published rows reject `UPDATE` **and** `DELETE`, with draft items guarded against their parent's status using a locking read; `response` uses typed per-type columns under one check constraint so an invalid answer shape cannot be stored; response immutability and audit append-only are enforced by grants, with `audit.event` reachable only through a `SECURITY DEFINER` function. `response` is range-partitioned monthly on `created_at` (set to the session's `submitted_at`, never defaulted) with no default partition. Concurrency is three row locks — questionnaire, question, session. Detail in [[9-database-schema]].
- **Observability:** OpenTelemetry throughout; `@fastify/otel` on the backend; browser propagates trace context so frontend and backend logs correlate per session.
- **Not in prototype:** Redis (documented as separate cache and durable-queue levers), ingest queue, frontend split (respondent app vs. admin portal — listed as future work; keep them separate entry points/packages from the start).

## Still to decide (in dependency order)

1. Checkpoint endpoint (`PUT /sessions/:id/progress`) — ship in the prototype or defer. **This is the current blocker**, and it is small: the rest of sessions/responses is decided, and [[9-database-schema#12. Open questions]] records the table shape either way so the decision stays additive.
2. The v2 demo change for the seeded questionnaire.
3. Two schema details left open: duplicate ids within `option_ids` (helper function or application validation), and whether `question.key` is carried into the snapshot alongside the uuid — [[9-database-schema#12. Open questions]].
4. Observability details, Kubernetes subsection, overview/goals/constraints, and the [[2-design-doc#16. Scale & Growth]] table.

Anything deferred rather than blocking lives in [[2-design-doc#18. Open Questions]] — check there before treating something as undecided. Deliberate simplifications in the format and rule model are listed in [[5-questionnaire-format#8. Future changes noted]]; they are settled, not open.

## Working conventions

- Talk through each decision one at a time; do not update docs until the user says so.
- Keep answers brief.

### Where writing goes

**Default to a detail doc; keep [[2-design-doc]] high-level and current.** Any topic with real depth gets its own numbered `docs/N-name.md` owning the full reasoning, and [[2-design-doc]] carries a condensed version — enough for a reviewer to grasp the shape and the decision — plus a pointer. Two standing rules follow:

- **Detail lives in exactly one place.** Never write the same reasoning in both; the design doc has to stay readable end to end in one sitting.
- **The design doc is never allowed to go stale.** A decision is not finished when the detail doc is written — it is finished when the design-doc section, the Decisions Log and [[4-implementation-plan]] reflect it in the *same* pass. An out-of-date index is worse than no index, because the design doc is the one document a reviewer reads front to back.

- A design-doc section backed by a detail doc opens with a `> **Detail:**` blockquote linking to that doc, and runs to a few paragraphs, not pages.
- Detail docs own the full type and constraint tables, serialized examples, algorithms, and per-decision alternatives.
- [[2-design-doc]] always owns two things regardless of how many detail docs exist: the [[2-design-doc#17. Decisions Log]] table (one row per decision — a named deliverable in the brief) and [[2-design-doc#18. Open Questions]] (everything punted, deferred or incomplete, in one place).
- Promote a topic to its own doc once its section outgrows a screen or two, then condense what is left behind.

### When a decision lands

1. Write it into the owning doc — the detail doc if there is one, otherwise the design-doc section.
2. Condense it into the design-doc section if the detail now lives elsewhere.
3. Add a [[2-design-doc#17. Decisions Log]] row: decision, alternatives considered, rationale, date.
4. Put the expanded alternatives in the detail doc's own "Alternatives considered" section. [[2-design-doc#17.1 Alternatives considered in detail]] keeps only decisions that have no detail doc, and points at the rest.
5. Move anything newly deferred into [[2-design-doc#18. Open Questions]], and tick [[4-implementation-plan]].

## Guiding principles when working on this repo

- Smaller-and-complete beats broad-and-unfinished. Never leave a critical path half done.
- Every shortcut, known risk, or omitted capability gets written down (decisions doc / README) so it can be discussed.
- Immutability of published versions is a hard invariant — enforce it in the data layer and tests, not just the UI.
- Keep definition and execution as distinct modules/services with an explicit boundary.
- When adding a feature, add the test for versioning/branching behavior first.
- AI coding agents are explicitly encouraged by the brief; keep this skill and project docs current so agents stay aligned.

