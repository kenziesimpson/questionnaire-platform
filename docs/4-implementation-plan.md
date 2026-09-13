# Implementation Plan

> Checkbox list. Design thinking happens in [[2-design-doc]] / [[3-scaling]]; this file tracks what's decided and what's built. Keep in dependency order.

## Phase 0 — Think through (decisions still open)

- [x] **Questionnaire format** — question types and per-type constraints, flat-list structure & ordering, required-ness on the item, serialization with a worked example ([[2-design-doc#5. Questionnaire Format]])
- [x] **Branching rules** — typed per-type condition union, single level of `all` / `any`, absent-answer semantics, next-question evaluation, publish-time validation ([[2-design-doc#7. Branching Rules]])
- [x] **Definition storage split** — normalized authoring vs. JSONB published snapshot, publish as the seam, derived reverse-lookup index ([[2-design-doc#12. Database]] §12.1)
- [x] **Versioning model** — questionnaires (one draft, promotes in place, three-layer immutability, snapshot `formatVersion`), questions (append-only, no bank draft state, items pin the version at add time), and what a response stores ([[2-design-doc#6. Versioning & Immutability]])
- [x] **Database schema** — three schemas; draft-unreferenceable composite FKs; immutability triggers on `UPDATE` and `DELETE` plus a locking item guard; typed per-type `response` columns; monthly partitioning with no default partition; three row locks for concurrency; response immutability and audit append-only by grant ([[2-design-doc#12. Database]] §12.2, [[9-database-schema]])
- [x] **API boundary** — definition vs. execution as two encapsulated plugins, the published snapshot as the only artifact crossing, no unpinned definition read on the execution side, RFC 9457 errors and status conventions, access model and database-role barriers ([[2-design-doc#9. API / Service Boundary]], [[7-application-boundary]])
- [x] **Sessions & responses** — lifecycle `in_progress → submitted` and nothing else; retirement via a nullable `closes_at` (hard cutoff); submit server-authoritative, all-or-nothing, idempotent on a session-keyed answer digest; **no checkpoint endpoint** — deferred, so partial answers stay in the browser and nothing is written between session start and submit ([[2-design-doc#8. Sessions & Responses]], [[7-application-boundary#5. Execution API]], decisions log #25)
- [x] **The v2 demo change** — version 2 relabels `opt_hyperten` on `qst_which_condition` ("Hypertension" → "High blood pressure (hypertension)"), option id unchanged, nothing else altered. A predicate change is kept out of the seed and used as an integration fixture proving submit re-evaluates against the pinned definition ([[5-questionnaire-format#3.1 Version 2 — the demo change]], [[8-testing#6. Test data and fixtures]], decisions log #26)
- [x] **Frontend** — two Vite apps (`apps/respondent`, `apps/admin`) behind one nginx container with a shared `packages/ui`; respondent renders all visible items on one page with `localStorage` partials and storage-first resume; five admin screens with the bank as its own screen and edit-in-draft re-pinning; authoring concurrency rules; accessibility commitments; and the library slate ([[2-design-doc#10. Frontend]], [[10-frontend]], decisions log #27–#32)
- [x] **Two schema details** — both resolved. Duplicate ids within `option_ids` are rejected by the submit validator, not by a database constraint (Decisions Log #34); `question.key` is **not** carried into the snapshot, and the worked example now shows uuids from a seed that hardcodes them (Decisions Log #35). Both follow the simplicity principle, Decisions Log #33
- [x] **Observability details** — signal taxonomy (standard span attributes, log fields and levels, metrics), domain events, the answer-redaction enforcement ladder, cardinality rules, and collector setup local vs. hosted ([[2-design-doc#14. Observability]], [[6-observability]]). SLOs, alert thresholds and backup verification are a *recorded deferral* ([[6-observability#8. SLOs and alerting]]), not an omission
- [x] **Testing approach** — four layers, Fastify `inject()` for backend routes, Testcontainers Postgres with a template database per Vitest worker, Vitest + RTL components, three Playwright specs against the composed stack, one command via Vitest `projects`, two CI jobs ([[2-design-doc#15. Testing]], [[8-testing]])
- [x] *Writing, not deciding:* Overview, goals, constraints sections ([[2-design-doc#1. Overview]] §1–3)
- [x] *Writing, not deciding:* Kubernetes subsection ([[2-design-doc#13.2 Long-term (Kubernetes)]]) and the [[2-design-doc#16. Scale & Growth]] table, condensed from [[3-scaling]] §3–4 and [[9-database-schema#11. Migrations]]

## Phase 1 — Plan the build

- [x] **Gate A — the eight decisions that blocked the build.** Closed 2026-09-13 as [[2-design-doc#17. Decisions Log]] #33–#40: the simplicity principle, duplicate `option_ids`, `question.key` in the snapshot, the error-slug spelling, the submit digest, relative-date timezones, the database identities and connection strings, and list ordering
- [x] **Gate B — doc hygiene.** §1–§2 and §13.2/§16 written, the stale cross-reference in [[10-frontend]] removed, §4 and §19 prompts deleted, decisions log reordered, and the three sections an earlier audit never reached re-read. That audit found a real bug in [[9-database-schema#9.1 A dedicated role, inside the publish transaction]]'s DDL, reproduced against live Postgres 16 and fixed
- [x] **The build plan itself** — gates, waves, file ownership, milestones and intervention points, all in Phase 2 below

## Phase 2 — Build

> Written to be executed by parallel coding agents. Read [[#Standing rules]] first — they are the difference between agents that compose and agents that fight.

### Standing rules

1. **Prefer the simple, out-of-the-box thing** ([[2-design-doc#17. Decisions Log]] #33). Stock tooling, generated migrations, application validation over a database object built only to hold it. The exception is narrow: where the data layer is the *stated* enforcement point for an invariant (#17, #24), the custom object earns its place. An agent reaching for a new custom migration should be able to name the guarantee it carries.
2. **Own your files.** The ownership table below is exhaustive. Do not edit a file another track owns — file a request instead. The contended files change in Wave 1a and Track 2 only.
3. **Never invent a decision.** Everything traces to a doc or a decisions-log row. If a load-bearing decision is missing, stop and ask — see [[#Stop and ask]].
4. **Tests are written with the feature, not after.** Each track fills its slice of [[8-testing#7. Test case enumeration]] as it goes: one row per case, grouped by [[8-testing#2. Layers]], naming the invariant it defends and the [[8-testing#3. Required coverage — the graded list]] row it discharges.

### Wave 1a — the contract commit *(serial, one agent, nothing else runs)*

- [ ] Domain types in `packages/shared`: `Question`, `QuestionVersion`, `Option`, `Item`, the `Condition` / `Predicate` union, `PublishedDefinition`, `Answer`, `AnswerValue`, `Session`, `Receipt`. Five response types — there is no `yes_no` (#36)
- [ ] One TypeBox schema per route, request and response, for all 21 routes. Most definition routes are one line of prose in [[7-application-boundary]] today; this is where their shapes are fixed
- [ ] The RFC 9457 error union as a closed TypeScript union with constructors
- [ ] `Sensitive<T>` and the telemetry boundary module signature, plus the ESLint rule. **Wave 1a, not Wave 3b** — these constrain every handler written afterwards, and retrofitting means auditing call sites instead of being stopped at write time

### Wave 1b — three parallel tracks

**Track 1 — engine and validators** (`packages/shared`, same agent continues)
- [ ] `evaluateVisibility(definition, answers)` — pure, no I/O
- [ ] Per-type answer validators and constraints. Relative date constraints take `today` as a parameter and never read a clock ([[5-questionnaire-format#2.4 Relative date constraints resolve against two different clocks]])
- [ ] Publish-time definition validator — one implementation, called by the publish route *and* the draft editor's live validation
- [ ] The answer digest ([[7-application-boundary#5.4 Submit: authority, validation, idempotency]]). Must stay a pure function of the persisted `response` rows
- [ ] `option_ids` uniqueness — the one `response` invariant not enforced below the application (#34)

**Track 2 — database** (`apps/backend/drizzle/**`, `apps/backend/src/db/**`, `db/init/**`)
> **One agent, start to finish, do not split.** [[9-database-schema#11. Migrations]] catalogues traps that fail *silently*; a mid-track handoff is how one survives.
- [ ] `schema.ts` for `definition` / `execution` / `audit`; generated migration for tables, indexes and FKs including the post-hoc circular FK
- [ ] `--custom` migrations: immutability triggers on `UPDATE` and `DELETE`, the locking item guard, the audit `SECURITY DEFINER` function in the verified order, `response_shape`, range partitioning with no default partition
- [ ] `db/init/01-roles.sh` — five identities, three connection strings ([[9-database-schema#11.3 Roles are not schema, and must not be in a committed migration]]). `qp_owner` must **not** be `POSTGRES_USER`
- [ ] Wire the three URLs into compose and `.env.example`; drop the unsuffixed `DATABASE_URL`; keep the loopback bind
- [ ] Partition management helper; seed with **hardcoded** ids (#35), through the real publish path
- [ ] DB invariant tests → **M2**

**Track 3 — UI package and restructure** (`apps/respondent`, `apps/admin`, `packages/ui`)
- [ ] Replace `apps/frontend` with `apps/respondent` + `apps/admin`; fix root scripts (they hardcode `-w apps/frontend`), tsconfig refs, Vite configs
- [ ] `packages/ui`: Tailwind v4, then the shadcn setup — `components.json`, path aliases, CLI writing into a package rather than an app. That setup is the real cost of #32; budget for it
- [ ] The renderer: controlled-props-only, one component per response type, the `aria-live` region, ARIA off error/touched state
- [ ] Component tests and the axe check → **M3**; nginx serving both builds at one origin

### Wave 2 — API plugins *(two parallel tracks)*

**Track 4 — definition plugin.** 18 routes. Land `GET /questionnaires` first to unblock Track 6. Publish is the hard one: snapshot serialization, validation, promote-in-place, and the audit write in the same transaction under the documented locks. → **M4**

**Track 5 — execution plugin.** Three routes, the trickiest correctness in the project: pin the snapshot and never re-resolve; resume; submit re-evaluated against the *pinned* definition, all-or-nothing, idempotent on the digest under `FOR UPDATE`. Runs on `qp_execution`, and a test must prove it cannot reach authoring tables. → **M5**, **M6**

### Wave 3 — the two apps *(two parallel tracks)*

> **Blocked until the five gaps in [[#Stop and ask]] are answered.** [[10-frontend]] does not decide them, and an agent will invent all five.

**Track 6 — admin app.** Five screens, code-based TanStack Router, TanStack Query, hand-rolled form state, dnd-kit reorders as optimistic draft mutations through the `If-Match` path with rollback on `409 questionnaire/draft-stale`.

**Track 7 — respondent app.** No router; a state machine after one entry URL. Plain `fetch`, TanStack Form, `localStorage` partials including hidden items, filtered to visible once at submit. Storage-first resume. Client-side date validation against the **browser's** local date.

### Wave 3b — observability and pipeline

**Track 8 — telemetry.** OTel end to end, the Collector seam, domain events as paired log+counter, the `/telemetry` ingest endpoint with `sendBeacon`, the opt-in compose profile. The safety boundary already landed in Wave 1a. → **M7**

**Track 9 — end-to-end and CI.** Three Playwright specs, one command via Vitest `projects`, two CI jobs, the sentinel canary gated. → **M8**, **M9**

### File ownership

| Path | Track |
| --- | --- |
| `packages/shared/**` | 1 |
| `apps/backend/drizzle/**`, `apps/backend/src/db/**`, `db/init/**` | 2 |
| `packages/ui/**` | 3 |
| `apps/backend/src/plugins/definition/**` | 4 |
| `apps/backend/src/plugins/execution/**` | 5 |
| `apps/admin/**` | 6 |
| `apps/respondent/**` | 7 |
| `apps/backend/src/telemetry/**`, collector config | 8 |
| `e2e/**`, CI workflows | 9 |
| `docs/**`, `README.md`, `.claude/skills/**` | nobody — a doc-only pass, never a build agent |

**Contended:** root `package.json`, `tsconfig.base.json`, `docker-compose*.yml`, `.env.example`, the Vitest root config. Changed in Wave 1a and Track 2 only; any later track files a request rather than editing.

### Stop and ask

An agent must not decide these alone. The first five block Wave 3.

- [ ] Admin list sort and filter UI — #40 assigns sorting to the client but names no controls
- [ ] Which control renders each of the five response types. Only the date control is pinned, to native `<input type="date">`
- [ ] The draft editor's publish-validation error surface, and where `422 questionnaire/draft-invalid`'s per-item failures land
- [ ] How `errorsByItemId` is built from the RFC 9457 body — the field names live only in [[7-application-boundary#6.1 Error format — RFC 9457 problem details]] and are not cross-referenced from the frontend doc
- [ ] The question editor's constraint fields per response type
- [ ] Anything that would add a custom migration, widen a grant, put an unpersisted value in the digest, or change what crosses the definition/execution boundary

### Agent-verified milestones

A wave is not done until its milestones are green.

- [ ] **M1** Engine units: branching truth table, every operator against every type, unanswered → `false`, digest determinism under key reordering, timezone cases
- [ ] **M2** DB invariants on Testcontainers: `UPDATE` and `DELETE` on published rows rejected; bad `response_shape` rejected; `qp_execution` denied on authoring tables; `qp_definition` denied on `response` and on `audit.event`; audit reachable only through `audit.record`; no-default-partition behaviour
- [ ] **M3** Renderer components plus the axe check; reveal and removal announced via `aria-live`
- [ ] **M4** Definition API via `inject()`: bank CRUD, stale-ETag `409`, publish happy path, publish failures as `422`, archived question rejected at add time, version history, deterministic list order
- [ ] **M5** Execution API via `inject()`: session pins the snapshot and ignores a later publish; resume; submit; idempotent replay returns the original receipt; answer to an invisible item `422`; the v1/v2 predicate-tightening fixture; closed questionnaire `409`
- [ ] **M6** Cross-version aggregation: v1 and v2 responses aggregate on `opt_hyperten` while each renders through its own pinned `questionVersion`
- [ ] **M7** Telemetry sentinel canary: a planted answer value reaches no exporter
- [ ] **M8** Three Playwright specs against the composed stack
- [ ] **M9** Whole suite, one command, headless, both CI jobs green from a clean clone

### Manual checkpoints

The things a green test cannot tell you.

- [ ] **H1** *(after Track 2)* `docker compose up` from clean; then open `psql` and try to `UPDATE` a published snapshot yourself. Feel the barrier rather than trusting a green test
- [ ] **H2** *(after Track 2)* Read the generated migration SQL by hand. [[9-database-schema#11. Migrations]]'s traps fail *silently*, and generated SQL is where they survive review
- [ ] **H3** *(after Waves 2)* Drive the API by hand through the demo flow once and read the problem+json bodies. Shape and wording are judgement, not assertion
- [ ] **H4** *(after Track 7)* Fill the demo questionnaire in a browser: answer yes, watch the branch appear; switch to no, watch it and its answers disappear; reload and resume; submit and confirm storage cleared
- [ ] **H5** *(after Tracks 3, 6, 7)* Keyboard-only pass on both apps, then a screen reader on the reveal/remove announcement and on a dnd-kit reorder. No automated check covers this, and it is the accessibility claim the medical domain rests on
- [ ] **H6** *(after Track 6)* Author from the bank, reorder by keyboard, set a predicate, preview, publish, read version history. Then open a second tab and provoke the draft `409` deliberately
- [ ] **H7** *(after Track 8)* Enable the opt-in profile, submit once, follow the trace end to end including the client span, and confirm no answer value appears anywhere in it
- [ ] **H8** *(end)* Fresh clone, follow the README only, see whether it works. Then read [[2-design-doc]] the way a reviewer will
