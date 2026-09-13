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
- [ ] Reusable questions with response types: text, single choice, multiple choice, number, date, yes/no. **Yes/No is an editor template over `single_choice`, not a storage type** (Decisions Log #36) — the capability must stay visible in the admin UI even though there are five types.
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
- [[10-frontend]] — **detailed** design for the frontend: the two applications and the shared renderer, the respondent rendering and resume model, the five admin screens, authoring concurrency as it surfaces in the UI, accessibility commitments, and the library slate with reasoning; the depth behind design-doc §10.
- [[3-scaling]] — scaling constraints, load model, and ordered levers (each with a trigger). Redis lives here, not in the prototype.
- [[4-implementation-plan]] — checkbox list of open decisions and build tasks; tick items as they land.
- [[1-ideation]] — original brainstorm; superseded where the design doc disagrees.

Sibling skills in `.claude/skills/`: **database** (schema invariants, roles, migration mechanics and verified Postgres traps — load before touching schema, migrations, repositories or seeds).

## Decisions made so far (don't relitigate without reason)

- **Stack:** React + TypeScript via Vite (plain SPA); Fastify on Node LTS; PostgreSQL via Drizzle ORM + `pg` driver, `drizzle-kit` SQL migrations; TypeScript throughout with a shared workspace package for API types and the rule engine.
- **Deployment:** separate `frontend` (nginx serving the build, reverse-proxying `/api` as a stand-in for a production ingress), `backend`, `migrate` (one-shot migrate + seed, gates backend) and `db` containers in Docker Compose. `docker-compose.override.yml` gives Vite HMR / `tsx watch` locally with polling file-watch enabled up front. Kubernetes long-term with the same split.
- **Auth:** out of scope; the access *model* and data barriers must still be written down.
- **Execution model:** client receives the whole published definition once per session and evaluates branching locally with the shared rule engine; partial answers live in the browser; the server keeps a small **session record** (pins the version, makes submit idempotent, shows where respondents abandon); submit is the single write; the **server recomputes the reachable path on submit and is the authority**. **No checkpoint endpoint** — deferred (Decisions Log #25), because without auth the session id sits in the same browser storage as the answers it would recover; nothing is written to the server between session start and submit.
- **Versioning stance:** a session is pinned to a version at start and keeps it; new sessions get the latest published version; no client polling for updates.
- **Questionnaire format:** a version is a **flat ordered list of items**. Order is the list index; there are no edges between questions, so branches converge automatically. Each item carries `required` and an optional `visibleWhen` predicate — both placement concerns, never on the reusable question. Five response types; **there is no `yes_no` type** — a yes/no question is a `single_choice` with two options from an editor template seeding reserved ids `yes` / `no` with editable labels, so it can be phrased True / False (Decisions Log #36, superseding #10). Option ids and answer units are stable across question versions. Detail in [[5-questionnaire-format]].
- **Relative date constraints** (`not_future` / `not_past`): the client validates against the **browser's local date**, the server against **UTC today with one day of tolerance** (Decisions Log #38). Strict UTC would block a correct answer for respondents far enough east or west. **Provisional** — the exact fix (client submits its UTC offset) is [[2-design-doc#18. Open Questions]] §14. The shared evaluator takes `today` as a parameter; it must never read a clock itself.
- **Branching:** a single level of `all` / `any` over conditions **typed per response type**, so invalid comparisons are unrepresentable rather than a runtime error class. Predicates may reference only earlier questions, which makes cycles and deadlock unrepresentable rather than detected. A condition on a question that was not shown is `false` for every operator. Publish-time validation covers forward references, exact satisfiability by domain intersection, and referential integrity.
- **List endpoints:** every list has an explicit `ORDER BY` on an existing index — `id DESC` (UUIDv7, so the PK index *is* creation order) for `/questions` and `/questionnaires`, `version DESC` for the histories. Not optional: unspecified order is heap order, which shifts after an `UPDATE`. **No pagination** — lists are dozens to hundreds of rows and go to the client whole, so sorting and filtering are client-side; the exit when it is needed is keyset pagination on the same key (Decisions Log #40).
- **Definition storage:** normalized rows for authoring; one **immutable JSONB snapshot per published version**, written in the publish transaction. Snapshots carry a `formatVersion` and are upgraded in memory at read time — stored bytes are never rewritten. A derived `version_question_index` restores reverse lookups.
- **Publishing:** promotes the draft row in place to version N; at most one draft per questionnaire, enforced by a partial unique index. Immutability enforced in three layers — DB trigger, API `409`, and a test that bypasses the API to hit the database directly.
- **Retirement:** one nullable `closes_at` covers both ongoing and scheduled-close questionnaires. Hard cutoff for now: both starting and submitting are rejected past the date, and the respondent app renders a "responses closed" page.
- **Question versioning:** questions are **append-only** — no draft state on the bank, every save writes a new immutable `question_version` row, so saving is publishing. A stable `questionId` carries identity across revisions; a questionnaire item **pins the question version at add time** and keeps it. Saving is an explicit action (closing the edit dialog), so one save is one version. No "upgrade to latest" action yet.
- **Submit idempotency:** `SHA-256(JSON.stringify(...))` over the validated response rows — sorted by `itemId`, `optionIds` sorted, numbers as exact decimal strings, unanswered optional items absent — canonicalized once in `@qp/shared` (Decisions Log #37). Digest the rows, never the request body. It must stay a pure function of the persisted `response` rows, which is what makes a later change a backfill.
- **Responses store** `questionId` (what you aggregate on), `questionVersion` (what you render with), the questionnaire version, and option ids or `{ value, unit }`. Prompt and label text are not copied onto responses — the snapshot holds those.
- **The seeded demo's v2** relabels exactly one option — `opt_hyperten`, "Hypertension" → "High blood pressure (hypertension)" — keeping the id, so v1 and v2 responses aggregate together while each renders through its own pinned `questionVersion`. Rewording a prompt, adding options and adding a conditional item were all rejected as weaker (monotone changes put nothing at risk). A predicate change stays out of the seed and becomes an integration fixture proving submit re-evaluates against the *pinned* definition. See [[5-questionnaire-format#3.1 Version 2 — the demo change]].
- **Nothing is deleted; things are hidden.** Questionnaires retire, questions archive, question versions append, snapshots and responses are immutable. Apply this by default to any new entity's lifecycle. The one exception is erasure on request (GDPR/HIPAA), which is a separate audited capability, not normal operation.
- **API boundary:** the boundary is an **artifact, not a route prefix**. Exactly one object crosses it — the immutable `PublishedDefinition` snapshot — and the dependency runs one way; execution never reads a draft, resolves a `questionId`, or joins to an authoring table. Enforced in three layers: encapsulated Fastify plugins with no cross-imports (ESLint zone rule), wire types in `@qp/shared`, and two database roles (`qp_execution` has no grant on authoring tables; `qp_definition` has **no grant on `response`**). `/api/definition/*` owns bank, drafts, publish, retire and version history; `/api/run/*` is three routes and has **no unpinned definition read**, so mid-session version drift is unrepresentable. RFC 9457 `problem+json`, `400` schema-only / `409` state conflict / `422` domain-invalid, and error bodies never echo a submitted answer. Submit is server-authoritative, all-or-nothing, idempotent on the session via an answer digest. Two plugins in one process now; splitting into two services is a deployment change, kept cheap deliberately. Detail in [[7-application-boundary]].
- **Database schema:** three schemas — `definition`, `execution`, `audit`. Four invariants live in the data layer: a draft is structurally unreferenceable (`version IS NULL` while draft, so composite FKs from `NOT NULL` columns match only published rows); published rows reject `UPDATE` **and** `DELETE`, with draft items guarded against their parent's status using a locking read; `response` uses typed per-type columns under one check constraint so an invalid answer shape cannot be stored; response immutability and audit append-only are enforced by grants, with `audit.event` reachable only through a `SECURITY DEFINER` function. `response` is range-partitioned monthly on `created_at` (set to the session's `submitted_at`, never defaulted) with no default partition. Concurrency is three row locks — questionnaire, question, session. Detail in [[9-database-schema]].
- **Frontend topology:** **two Vite apps** — `apps/respondent` and `apps/admin` — served by one nginx container (respondent at `/`, admin at `/admin/`, `base: '/admin/'` required). Shared `packages/ui` holds `primitives/` (shadcn over Radix, both apps) and `questionnaire/` (the renderer, used by the respondent form and admin preview). **`packages/ui` owns no fetching, routing or form state** — the renderer is controlled by props. The app boundary is package resolution, not a lint rule.
- **Respondent:** one URL `/q/:questionnaireId` and a state machine behind it, no router. **All visible items render on one page**, re-evaluating predicates on every answer. Partial answers in `localStorage` **including hidden items**, filtered to the visible set once at submit. On landing, check storage and resume before creating a session. No resume-link route.
- **Admin:** five screens — questionnaire list, draft editor, question bank, version history, preview. The bank has its own screen *and* questions can be created/edited inside the draft editor, where **editing re-pins that item** to the new version. Predicate editor is a flat row list offering only earlier questions and only type-valid operators. Draft writes go through the `If-Match` ETag with optimistic reorder and rollback on `409`.
- **Authoring concurrency:** add-item carries the displayed `questionVersion` (never resolve "current" server-side); concurrent edits to one question are **accepted and documented, not guarded** (append-only loses no version, and explicit pinning means a lost edit cannot reach a snapshot or a response); adding an archived question is rejected.
- **Frontend libraries:** respondent stays dependency-light and imperative, admin takes tooling where it has cached server state or conventional editing. TanStack Router (**code-based**) + TanStack Query in admin; plain `fetch` + TanStack Form in respondent; **no form library in admin**; dnd-kit for reordering (keyboard sensor + announcements); Tailwind v4 + shadcn/Radix in both. The asymmetry is deliberate — say so when it comes up.
- **Accessibility** is designed in, not audited afterwards, because the domain is medical: semantic markup with `aria-invalid`/`aria-describedby`, an **`aria-live` region announcing dynamically revealed questions** (the gap the single-page model creates), focus to the first invalid item on rejected submit, and an axe check in the end-to-end specs. A full WCAG audit and a screen-reader matrix are explicitly out.
- **Observability:** OpenTelemetry throughout; `@fastify/otel` on the backend; browser propagates trace context so frontend and backend logs correlate per session.
- **Not in prototype:** Redis (documented as separate cache and durable-queue levers), ingest queue, the checkpoint endpoint, and separate *deployment* of the two frontends — they are already two applications, so what remains is a second container and a routing rule.

## Still to decide (in dependency order)

**Phase 0 design is complete.** What remains is small or is writing.

1. ~~Two schema details~~ — **both resolved.** Duplicate ids within `option_ids` are the submit validator's job, not the database's (Decisions Log #34); `question.key` is not carried into the snapshot, `questionId` there is the bank uuid, and the seed hardcodes its ids so the documented uuids are real (Decisions Log #35).
2. *Writing, not deciding:* the Kubernetes subsection, overview/goals/constraints (§1–3), and the [[2-design-doc#16. Scale & Growth]] table — all condensable from decisions already made.
3. **Phase 1 — the build plan itself** ([[4-implementation-plan]]): implementation order, what parallelises, seed data, demo script, README outline, and the test cases written alongside each feature rather than after.

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

- **Prefer the simple, out-of-the-box thing** (Decisions Log #33). Where two designs deliver materially the same guarantee, take the one with less bespoke machinery: stock tooling over hand-rolled, generated migrations over custom SQL, application validation over a database object built only to hold it. The exception is deliberate and narrow — where the data layer is the *stated* enforcement point for an invariant (#17, #24), the custom object earns its place. Distinguish machinery that carries a guarantee we are claiming from machinery that closes a shape nothing can produce.
- Smaller-and-complete beats broad-and-unfinished. Never leave a critical path half done.
- Every shortcut, known risk, or omitted capability gets written down (decisions doc / README) so it can be discussed.
- Immutability of published versions is a hard invariant — enforce it in the data layer and tests, not just the UI.
- Keep definition and execution as distinct modules/services with an explicit boundary.
- When adding a feature, add the test for versioning/branching behavior first.
- AI coding agents are explicitly encouraged by the brief; keep this skill and project docs current so agents stay aligned.

