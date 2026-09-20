# Implementation Plan

> Checkbox list. Design thinking happens in [[2-design-doc]] / [[3-scaling]]; this file tracks what's decided and what's built. Keep in dependency order.

## Phase 0 — Think through (decisions still open)

- [x] **Questionnaire format** — question types and per-type constraints, flat-list structure & ordering, required-ness on the item, serialization with a worked example ([[2-design-doc#5. Questionnaire Format]])
- [x] **Branching rules** — typed per-type condition union, single level of `all` / `any`, absent-answer semantics, next-question evaluation, publish-time validation ([[2-design-doc#7. Branching Rules]])
- [x] **Definition storage split** — normalized authoring vs. JSONB published snapshot, publish as the seam, derived reverse-lookup index ([[2-design-doc#Authoring vs published]])
- [x] **Versioning model** — questionnaires (one draft, promotes in place, three-layer immutability, snapshot `formatVersion`), questions (append-only, no bank draft state, items pin the version at add time), and what a response stores ([[2-design-doc#6. Versioning & Immutability]])
- [x] **Database schema** — three schemas; draft-unreferenceable composite FKs; immutability triggers on `UPDATE` and `DELETE` plus a locking item guard; typed per-type `response` columns; monthly partitioning with no default partition; three row locks for concurrency; response immutability and audit append-only by grant ([[2-design-doc#12. Database]], [[9-database-schema]])
- [x] **API boundary** — definition vs. execution as two encapsulated plugins, the published snapshot as the only artifact crossing, no unpinned definition read on the execution side, RFC 9457 errors and status conventions, access model and database-role barriers ([[2-design-doc#9. API / Service Boundary]], [[7-application-boundary]])
- [x] **Sessions & responses** — lifecycle `in_progress → submitted` and nothing else; retirement via a nullable `closes_at` (hard cutoff); submit server-authoritative, all-or-nothing, idempotent on a session-keyed answer digest; **no checkpoint endpoint** — deferred, so partial answers stay in the browser and nothing is written between session start and submit ([[2-design-doc#8. Sessions & Responses]], [[7-application-boundary#5. Execution API]], decisions log #25)
- [x] **The v2 demo change** — version 2 relabels `opt_hyperten` on `qst_which_condition` ("Hypertension" → "High blood pressure (hypertension)"), option id unchanged, nothing else altered. A predicate change is kept out of the seed and used as an integration fixture proving submit re-evaluates against the pinned definition ([[5-questionnaire-format#3.1 Version 2 — the demo change]], [[8-testing#6. Test data and fixtures]], decisions log #26)
- [x] **Frontend** — two Vite apps (`apps/respondent`, `apps/admin`) behind one nginx container with a shared `packages/ui`; respondent renders all visible items on one page with `localStorage` partials and storage-first resume; five admin screens with the bank as its own screen and edit-in-draft re-pinning; authoring concurrency rules; accessibility commitments; and the library slate ([[2-design-doc#10. Frontend]], [[10-frontend]], decisions log #27–#32)
- [x] **Two schema details** — both resolved. Duplicate ids within `option_ids` are rejected by the submit validator, not by a database constraint (Decisions Log #34); `question.key` is **not** carried into the snapshot, and the worked example now shows uuids from a seed that hardcodes them (Decisions Log #35). Both follow the simplicity principle, Decisions Log #33
- [x] **Observability details** — signal taxonomy (standard span attributes, log fields and levels, metrics), domain events, the answer-redaction enforcement ladder, cardinality rules, and collector setup local vs. hosted ([[2-design-doc#14. Observability]], [[6-observability]]). SLOs, alert thresholds and backup verification are a *recorded deferral* ([[6-observability#8. SLOs and alerting]]), not an omission
- [x] **Testing approach** — four layers, Fastify `inject()` for backend routes, Testcontainers Postgres with a template database per Vitest worker, Vitest + RTL components, three Playwright specs against the composed stack, one command via Vitest `projects`, parallel CI jobs ([[2-design-doc#15. Testing]], [[8-testing]])
- [x] *Writing, not deciding:* Overview, goals, constraints sections ([[2-design-doc#1. Overview]] §1–3)
- [x] *Writing, not deciding:* Kubernetes subsection ([[2-design-doc#Kubernetes]]) and the [[2-design-doc#16. Scale & Growth]] table, condensed from [[3-scaling]] §3–4 and [[9-database-schema#11. Migrations]]

## Phase 1 — Plan the build

- [x] **Gate A — the eight decisions that blocked the build.** Closed 2026-09-13 as [[2-design-doc#17. Decisions Log]] #33–#40: the simplicity principle, duplicate `option_ids`, `question.key` in the snapshot, removing the `yes_no` type, the submit digest, relative-date timezones, the database identities and connection strings, and list ordering
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

> Seven questions this wave raised were answered on 2026-09-13 and are now in the docs: ESLint at the root (not oxlint, which lives only in the scaffold Track 3 deletes); `modules/` and `packages/telemetry` as the folder names, per [[7-application-boundary#3.1 Module encapsulation]] and [[6-observability]] rather than the ownership table, which was wrong and is corrected above; `itemId` as the key for conditions, wire answers, the digest and `onChange`, with publish rejecting duplicate placements (#41); decimal-string numbers with the server filling `unit` (#42); four newly-pinned problem slugs ([[7-application-boundary#6.1 Error format — RFC 9457 problem details]]); the `Receipt` shape ([[7-application-boundary#5.4 Submit: authority, validation, idempotency]]); and `draft_revision` as the ETag source with `updated_at` for display (#43).

- [x] Domain types in `packages/shared`: `Question`, `QuestionVersion`, `Option`, `Item`, the `Condition` / `Predicate` union, `PublishedDefinition`, `Answer`, `AnswerValue`, `Session`, `Receipt`. Five response types — there is no `yes_no` (#36)
- [x] One TypeBox schema per route, request and response, for all 21 routes. Most definition routes are one line of prose in [[7-application-boundary]] today; this is where their shapes are fixed
- [x] The RFC 9457 error union as a closed TypeScript union with constructors
- [x] `Sensitive<T>` and the telemetry boundary module signature, plus the ESLint rule. **Wave 1a, not Wave 3b** — these constrain every handler written afterwards, and retrofitting means auditing call sites instead of being stopped at write time

### Wave 1b — three parallel tracks

**Track 1 — engine and validators** (`packages/shared`, same agent continues)
- [x] `evaluateVisibility(definition, answers)` — pure, no I/O
- [x] Per-type answer validators and constraints. Relative date constraints take `today` as a parameter and never read a clock ([[5-questionnaire-format#2.4 Relative date constraints resolve against two different clocks]])
- [x] Publish-time definition validator — one implementation, called by the publish route *and* the draft editor's live validation
- [x] The answer digest ([[7-application-boundary#5.4 Submit: authority, validation, idempotency]]). Must stay a pure function of the persisted `response` rows
- [x] `option_ids` uniqueness — the one `response` invariant not enforced below the application (#34)

**Track 2 — database** (`apps/backend/drizzle/**`, `apps/backend/src/db/**`, `db/init/**`)
> **One agent, start to finish, do not split.** [[9-database-schema#11. Migrations]] catalogues traps that fail *silently*; a mid-track handoff is how one survives.
- [x] `schema.ts` for `definition` / `execution` / `audit`; generated migration for tables, indexes and FKs including the post-hoc circular FK
- [x] `--custom` migrations: immutability triggers on `UPDATE` and `DELETE`, the locking item guard, the audit `SECURITY DEFINER` function in the verified order, `response_shape`, range partitioning with no default partition
- [x] `db/init/01-roles.sh` — six identities, four connection strings (`qp_reporting` joined in Wave 3a, Decisions Log #89) ([[9-database-schema#11.3 Roles are not schema, and must not be in a committed migration]]). `qp_owner` must **not** be `POSTGRES_USER`
- [x] Wire the three URLs into compose and `.env.example`; drop the unsuffixed `DATABASE_URL`; keep the loopback bind
- [x] Partition management helper; seed with **hardcoded** ids (#35), through the real publish path
- [x] DB invariant tests → **M2**

**Track 3 — UI package and restructure** (`apps/respondent`, `apps/admin`, `packages/ui`)
- [x] Replace `apps/frontend` with `apps/respondent` + `apps/admin`; fix root scripts (they hardcode `-w apps/frontend`), tsconfig refs, Vite configs
- [x] `packages/ui`: Tailwind v4, then the shadcn setup — `components.json`, path aliases, CLI writing into a package rather than an app. That setup is the real cost of #32; budget for it
- [x] The renderer: controlled-props-only, one component per response type, the `aria-live` region, ARIA off error/touched state
- [x] Component tests and the axe check → **M3**; nginx serving both builds at one origin

### Gate C — CI before Wave 2

> Wave 2 is two tracks merging in parallel into the same backend. A red check has to stop a PR before review, not after merge, so job 1 of [[8-testing#5.2 Pipeline shape]] is brought forward from Track 9. Track 9 still owns the workflow and adds the end-to-end job.

- [x] `.github/workflows/ci.yml` — on every push to `main` and every pull request, Node from `.nvmrc`. Gate C landed it as one **Checks** job; it is now parallel jobs ([[8-testing#5.2 Pipeline shape]]): `changes` (decides whether anything but Markdown changed; every other job is skipped when only `.md` files did), `lint` (ESLint, then knip), `typecheck`, `build`, `unit-tests` (`npm test` in four shards), the "Response telemetry leak test" (`npm run test:leak-test`) and `e2e`. No Postgres service; Testcontainers supplies its own ([[8-testing#5.3 CI details that actually bite]])
- [ ] Every CI job green or skipped on `main` on GitHub, and required as a status check on `main`'s branch protection
- [ ] ~~Wave 2 does not start until both boxes above are ticked~~ **Waived 2026-09-13.** Wave 2 starts with CI running but no branch protection. Until the box above is ticked, checking for a green run before merging is the reviewer's job, not GitHub's. **Branch protection is unavailable on the current plan:** GitHub refuses it for a private repository on the free plan (`403`, "Upgrade to GitHub Pro or make this repository public"), so the box above stays unticked while the CI jobs are green on `main`

### Wave 2 — API plugins *(two parallel tracks)*

**Track 4 — definition plugin.** 18 routes. Publish is the hard one: snapshot serialization, validation, promote-in-place, and the audit write in the same transaction under the documented locks. → **M4**

> **Most of the hard part already exists.** Track 2 built `publishDraft`, `replaceDraft`, `createQuestionnaire`, `createQuestion` and `appendQuestionVersion` in `apps/backend/src/db/definition/`, each with its locks, audit write and integration tests. Track 4 is mostly route handlers that turn those functions' outcomes into HTTP responses, plus the read queries and three writes that don't exist yet: archive, open the next draft, and set `closesAt`.

#### How Track 4 runs

Three groups work in parallel, merging into a **`staging`** branch cut from `main`. A setup commit (G0) goes first and an integration pass (G4) goes last. `staging` merges to `main` once, when **M4** is green. Every change reaches `staging` through a pull request, which is what runs CI: the workflow runs on every pull request whatever the base branch, and a push to `staging` does not trigger it. The final `staging → main` PR runs CI on the combined result.

**Rules for every group:**

1. **Only the files your group owns** ([[#Track 4 file split]]). `apps/backend/src/db/schema.ts`, `audit.ts`, `client.ts`, `drizzle/**` and `packages/shared/**` are frozen for Track 4. A needed change there is a [[#Stop and ask]], not an edit.
2. **Set up test data through the database functions, never through another group's routes.** A G3 test that needs a published version calls `createQuestion`, `createQuestionnaire`, `replaceDraft` and `publishDraft` directly. That is what keeps the groups mergeable in any order.
3. **One route-group test file**, per [[8-testing#2.2 Backend integration — Fastify `inject()` against a real Postgres]], at `apps/backend/_tests/modules/definition/routes/<your routes file>.test.ts`, mirroring `src/` as `AGENTS.md` requires. Build the app with `useDefinitionApp`. Your test rows go under your group's heading in [[8-testing#7. Test case enumeration]].
4. **The author is `authorOf(request)`**, passed as `actorId` / `createdBy` on every write. Never `null`, and never the placeholder string typed at a call site. See [[2-design-doc#17. Decisions Log]] #57 before writing anything that stores it. `traceId` is `activeTraceId()` from `@qp/telemetry`: the trace id of the active span, whether or not it is sampled. The audit writers store a missing one as `null`.
5. **Every route is registered with `registerRoute` and the `definitionApi` object from `@qp/shared`.** No `scope.get` / `scope.route`, and no URL or schema written in the backend. G4's completeness test checks the result
6. **Every list keeps its `ORDER BY`** from [[7-application-boundary#4.1 Endpoints]]. A list test must create at least two rows and assert their order.

#### G0 — the definition plugin skeleton *(serial, lands on `staging` before G1–G3 start)*

**G0 also builds the shared HTTP layer Track 5 needs.** Track 5 paused and branches from `staging` once G0 has merged. It then adds its execution module to `buildApp` and `index.ts` rather than writing a second app factory or error handler.

- [x] `src/app.ts`: `buildApp`, the root not-found and error handlers, `/health`, and the definition module mounted at `DEFINITION_PREFIX` on its own `Database` passed through plugin options (no root decorator, per [[7-application-boundary#8.3 What we do now to keep the split cheap]]). `src/index.ts` opens the `qp_definition` pool and closes it on shutdown
- [x] `src/http/problems.ts`:
  - `sendProblem`
  - `requestValidatorCompiler`: path and query strings coerced to their schema types, headers and body exact, additional properties rejected rather than stripped
  - `replyWithProblem`: schema failures → `400 request/invalid` with a `schema/<keyword>` code per error; any other `4xx` → `400`; everything else → `500 internal`, with the trace id as `detail` (the request id when no span is active, T0b)
  - `replyNotFound`

  `src/http/database-errors.ts` reads the SQLSTATE and constraint name through drizzle's wrapped `cause` chain
- [x] `modules/definition/plugin.ts`: an encapsulated plugin with the validator compiler, the not-found handler, the definition error handler, and one `onRequest` author hook. The hook attaches `AUTHOR_PLACEHOLDER` ([[2-design-doc#17. Decisions Log]] #57). `authorOf(request)` throws on a request that did not pass through the hook, so a route registered outside the plugin fails loudly instead of writing no author
- [x] `modules/definition/errors.ts`, definition-only mapping kept out of `src/http`: `QP001` → `409 version/immutable`; `23505` on `question_version_pkey` only → `409 question/version-conflict`; a malformed `If-Match` → `400` pointing at `/headers/if-match`; everything else falls through to `replyWithProblem`
- [x] `modules/definition/if-match.ts`: `draftPreconditionOf(ifMatch)` throws `MalformedDraftPrecondition` for anything but a draft ETag the server issued (`*` included); `isCurrentDraft` compares the draft version id **and** the revision. Revision alone is not enough, because a newly opened draft restarts at `0` and an ETag from the previous draft would otherwise match. `replaceDraft` and `publishDraft` check only the revision today, so G2 and G3 must add the version id check
- [x] `src/http/routes.ts`: `registerRoute(scope, sharedRoute, handler)`. The handler's params, query, headers and body are typed from the shared `defineRoute` object, and it returns `{ status, body, headers? }` for a status the route declares, or a `Problem`. A wrong status, a body that does not match the schema, or an undeclared request part is a compile error
- [x] Empty route files `routes/questions.ts` (G1), `routes/drafts.ts` (G2), `routes/versions.ts` (G3), already registered by the plugin, so no group edits `plugin.ts`
- [x] `_tests/modules/definition/harness.ts`: `useDefinitionApp(testDatabase)` registers the module on a bare Fastify instance and returns it for `inject()`; `definitionUrl(path)` adds the prefix
- [x] **`GET /questionnaires`** as the pattern every later route copies: `routes/questionnaire-list.ts` over `db/definition/questionnaire-list.ts`, `id DESC`, with `currentVersion`, `closesAt` and `hasDraft`. Track 6 needs this route first

#### G1 — question bank *(parallel)*

`GET /questions`, `POST /questions`, `GET /questions/:questionId`, `GET /questions/:questionId/versions`, `GET /questions/:questionId/versions/:v`, `POST /questions/:questionId/versions`, `POST /questions/:questionId/archive`, `GET /questions/:questionId/usage`

- [x] Bank reads: latest version of each question with its options in `position` order, `?includeArchived=`, `id DESC`; version history `version DESC`; one version; usage from `version_question_index` ordered `questionnaire_id, version DESC`
- [x] `archiveQuestion`: sets `archived_at` once (archiving an already-archived question is a no-op that returns `200` and writes no second audit row), audited `archive_question`. Existing placements are unaffected
- [x] Question-rule failures (`QUESTION_RULE_CODES`) on create and on saving a version map to the `request/invalid` `errors` extension, as the shared types already define
- [x] Tests → **M4** *bank CRUD*, *deterministic list order*: create → v1; save → v2 with v1 unchanged; archived hidden by default and shown with `includeArchived`; unknown ids `404`; two concurrent saves become v2 and v3; usage lists only published versions

#### G2 — draft lifecycle *(parallel)*

`POST /questionnaires`, `GET /questionnaires/:id/draft`, `PUT /questionnaires/:id/draft`, `POST /questionnaires/:id/draft`, `POST /questionnaires/:id/draft/validate`

- [x] Draft read: `items` in `position` order and `questions` holding each pinned question version once; `ETag` from `formatDraftEtag`; `Cache-Control: no-store`
- [x] `PUT /draft` maps `replaceDraft`'s outcomes: `stale-or-missing-draft` → `409 questionnaire/draft-stale` when a draft exists, `404` when none does; `archived-question` and `unknown-question-version` → `422 questionnaire/draft-invalid` with the offending items in `items`. Responds with the new `ETag`. *(Narrowed by [[2-design-doc#17. Decisions Log]] #75: `archived-question` fires for newly placed items only — see [[#How Track 6 runs]].)*
- [x] `openNextDraft` (new, in `db/definition/questionnaires.ts`): `FOR UPDATE` on the questionnaire as the **first** statement ([[9-database-schema#5. Concurrency control]]), `409 questionnaire/draft-exists` when a draft is open, `404` when nothing has been published, then copy the latest published version's items with their pinned question versions, audited `create_draft`. A copied item whose question has since been archived is kept; ~~publish validation reports it~~ it is an existing placement, so under #75 neither saves nor publish report it
- [x] `validate` runs the same read-and-`validateDraft` path publish uses and never writes. If that needs `publishDraft`'s private helpers exported, G2 does that in `publish.ts` as a **pure extraction, no behaviour change**, and tells G3 before merging
- [x] Tests → **M4** *stale-ETag `409`*, *archived question rejected at add time*: two tabs, one gets `409`; the missing-`If-Match` `400`; two concurrent next-draft opens, where exactly one gets `201`; the copy pins the same question versions as the source; validate reports what publish would refuse and writes no audit row

#### G3 — publish, version history, retirement *(parallel)*

`POST /questionnaires/:id/publish`, `GET /questionnaires/:id/versions`, `GET /questionnaires/:id/versions/:v`, `PUT /questionnaires/:id/closes-at`

- [x] `POST /publish` maps `publishDraft`'s outcomes: `questionnaire-not-found` and `no-draft` → `404`; `stale` → `409 questionnaire/draft-stale`; `invalid` → `422 questionnaire/draft-invalid`; `published` → `201 VersionSummary`
- [x] Version reads (new file `db/definition/versions.ts`): history `version DESC`, metadata only, `itemCount` from the snapshot; one snapshot verbatim, with `ETag: "<questionnaireId>:<version>:<formatVersion>"` and `Cache-Control: private, max-age=31536000, immutable` (#44); a draft or an unknown version is `404`
- [x] `setClosesAt` (new file `db/definition/closes-at.ts`): questionnaire `FOR UPDATE` first; a non-null value (set or reschedule) is audited `retire` and `null` is audited `reopen`, each with `{ from, to }` in the summary; responds with `QuestionnaireSummary`
- [x] Tests → **M4** *publish happy path*, *publish failures as `422`*, *version history*: publish writes v1 then v2, with v1's snapshot byte-identical afterwards; a forward reference and an unsatisfiable predicate each return `422` naming the item; publish with a stale `If-Match` is `409`; the snapshot `ETag` and `Cache-Control` headers; clearing `closesAt` restores it

#### G4 — integration *(serial, on `staging`, after G1–G3)*

- [x] Route completeness: every entry in `definitionRoutes` is registered at its method and URL with the shared schema object. It lands here because it fails until every group has merged
- [x] One flow through `inject()` alone, using no database function directly: create a question → create a questionnaire → `PUT /draft` → `validate` → `publish` → save a question revision → open the next draft → re-pin → publish v2 → list versions → fetch both snapshots → set and clear `closesAt`
- [x] **M4** ticked
- [x] `staging → main` merged with CI green on its head
- [ ] **H3** done by hand against the merged Wave 2 API

#### Track 4 file split

Test paths mirror `src/` under `apps/backend/_tests/`.

| Path | Group |
| --- | --- |
| `src/app.ts`, `src/index.ts`, `src/http/**` (including `routes.ts`), `src/modules/definition/{plugin,author,errors,if-match}.ts`, `routes/questionnaire-list.ts`, `src/db/definition/questionnaire-list.ts`, `_tests/modules/definition/harness.ts` | G0 |
| `src/modules/definition/routes/questions.ts`, `src/db/definition/questions.ts`, `question-content.ts` | G1 |
| `src/modules/definition/routes/drafts.ts`, `src/db/definition/questionnaires.ts` | G2 |
| `src/modules/definition/routes/versions.ts`, `src/db/definition/publish.ts`, `versions.ts`, `closes-at.ts` | G3, apart from G2's pure extraction from `publish.ts` |
| `_tests/modules/definition/definition-api.test.ts` | G4 |

The seed (`src/db/seed/**`) calls G1's and G2's functions. A signature change there must keep the seed test green, and the seed files themselves stay unedited.

**Track 5 — execution plugin.** Three routes, the trickiest correctness in the project: pin the snapshot and never re-resolve; resume; submit re-evaluated against the *pinned* definition, all-or-nothing, idempotent on the digest under `FOR UPDATE`. Runs on `qp_execution`, and a test must prove it cannot reach authoring tables. → **M5**, **M6**

### Wave 3 — the two apps *(two parallel tracks)*

> **Unblocked 2026-09-14.** Every Wave 3 gap in [[#Stop and ask]] is answered — [[2-design-doc#17. Decisions Log]] #53–#55 on 2026-09-13, and #58–#74 on 2026-09-14, which adopt the prototypes in `docs/designs/` for the question editor's constraint fields and options widget and defer `publishedBy` with authentication. **Once the contract commit below lands, Track 6 (admin app) and Track 7 (respondent app) are both fully unblocked.**

#### Wave 3 contract commit *(serial, one agent, before Tracks 6 and 7 branch)*

> **The only Wave 3 change to `packages/shared`, `packages/ui` and `apps/backend`, with one later exception:** the gh#17 fix (#75), which the user authorised to land on `staging/track-6` ([[#How Track 6 runs]]). Otherwise, after it, Tracks 6 and 7 each touch only their own app. It crosses files Tracks 1, 3 and 4 own, which is why one agent does it before anything branches: both apps consume `errorsByItemId` (#62), and Track 6 builds against the other changes.

- [x] `errorsByItemId` in `packages/ui/src/questionnaire/`, with tests (#55, #62)
- [x] `QuestionnaireSummary.updatedAt` in `packages/shared`, plus the backend list query: the latest `questionnaire_version.updated_at` per questionnaire, not moved by a `closesAt` change (#59)
- [x] `question/type-changed` in `QUESTION_RULE_CODES`, plus the check in the backend's append-question-version path — `appendQuestionVersion`, under the question row lock it already takes — with a test (#61)
- [x] The shadcn primitives Track 6 needs in `packages/ui`: `Dialog`, `Select` / `Combobox`, `Table` and `Popover` (#66). Generated files, no questionnaire logic
- [x] Its rows in [[8-testing#7. Test case enumeration]]

**Track 6 — admin app.** Five screens, code-based TanStack Router, TanStack Query, hand-rolled form state, dnd-kit reorders as optimistic draft mutations through the `If-Match` path with rollback on `409 questionnaire/draft-stale`.

- The question editor's constraint fields and options widget follow `QuestionFields` and `AdminQuestionEditor` ([[10-frontend#5.3 The question editor, and re-pinning]], #58). **The Yes / No template button is a required deliverable** (#36, #58): it is how the brief's yes/no type is visible in the admin UI, and the only way a question gets the reserved `yes` / `no` ids. The type selector is disabled after a question's first save (#61)
- The author-facing `DraftItemCode` message catalogue (#60) gets a design subagent pass on its wording and presentation during execution. Its presentation calls are #76: no problem codes shown to authors (kept in `data-*` attributes for tests), a "no questions yet" all-clear for an empty draft rather than "Ready", and an (i) note on removing an archived question
- A `409 questionnaire/draft-exists` on opening the next draft refetches and navigates to the existing draft, with no error (#67)
- Preview's sample answers are plain inputs in an admin side panel; the renderer stays `readonly` (#68)
- The list and bank keep TanStack Query's default refetch-on-window-focus (#69)
- `publishedBy` is always `null`; the history screen renders it as absent (#64)
- **Two known bugs (#65, #75).** [gh#17](https://github.com/kenziesimpson/questionnaire-platform/issues/17) is **fixed in Wave 3** (#75, superseding #65's punt): archiving gates new placements only, so an archived question already placed in a draft no longer blocks `PUT /draft` or publish, and the draft editor shows no archived state. The backend change lands on `staging/track-6` ([[#How Track 6 runs]]); unarchive, the picker change and an archive warning stay deferred. [gh#15](https://github.com/kenziesimpson/questionnaire-platform/issues/15) is still punted: a taken `key` returns `500`, and `key` may be removed — so do not present a key input as required

#### How Track 6 runs

Every PR is staged on a **`staging/track-6`** branch cut from `main` after the Wave 3 contract commit merges. A serial skeleton, **PR0**, lands on `staging/track-6` first. The screen PRs follow, each through a pull request targeting `staging/track-6` with CI green; CI runs on every pull request whatever the base branch. PR0 pre-registers every route and seam, so the screen PRs touch disjoint files and merge into `staging/track-6` in any order their dependencies allow. `staging/track-6` merges to `main` once, when every PR below is in, with CI green on its head. **H6** is done by hand against it.

**Rules for every PR:**

1. **PR0 owns the seams.** Screen PRs build on the router, API client, query keys and mutation hook rather than writing their own.
2. **Every draft write goes through the shared optimistic-draft-mutation hook**, never a hand-rolled `useMutation` with its own `If-Match`.
3. **Tests with the feature.** Each PR adds its own rows to [[8-testing#7. Test case enumeration]] under a Track 6 heading.

**PR0 — the skeleton** *(serial, lands on `staging/track-6` before any screen PR)*

- [x] `router.tsx`: every screen's route registered with a stub component, so no screen PR edits the route tree
- [x] The API client: typed calls over `definitionApi` from `@qp/shared`, problem+json parsed into the shared error union, and the draft `ETag` captured and sent back as `If-Match`
- [x] Query keys, one module, so every screen invalidates the same keys
- [x] The shared optimistic-draft-mutation hook: apply locally, `PUT /draft` with `If-Match`, roll back and refetch on `409 questionnaire/draft-stale`

| PR | Screen | Depends on |
| --- | --- | --- |
| PR1 | Questionnaire list | PR0 |
| PR2 | Question editor dialog, including the Yes / No button | PR0 |
| PR3 | Question bank | PR2 |
| PR4 | Draft editor: items, reorder, predicate editor | PR2 |
| PR5 | Publish-checks panel and the draft-item message catalogue; removes PR4's archived badge and frozen-draft copy (#75), presentation per #76 | PR4, and the design subagent pass, which starts once PR4's panel host exists and blocks only PR5's copy and layout |
| History | Version history | PR0; can run in parallel |
| Preview | Preview | PR0; can run in parallel |
| PR6 | Integration, plus **H5** (admin half) and **H6** | Everything above |
| gh#17 fix | Not a screen: archiving gates new placements only (#75), in `apps/backend`; `packages/shared`'s draft validator is unchanged | Nothing in Track 6; lands before `staging/track-6` merges to `main` |

- [x] gh#17 fix (#75) merged into `staging/track-6`: `PUT /draft`, validate and publish report `draft/question-archived` only for items whose `(questionId, questionVersion)` pair is not already in the stored draft, with tests
- [x] `staging/track-6 → main` merged with CI green on its head

**PR4 must tell a `422` from a `409`.** A `422 questionnaire/draft-invalid` is not a stale conflict and must not be reported as someone else's edit. Before the gh#17 fix lands, a reorder can hit one from an archived question elsewhere in the draft, for reasons that have nothing to do with the reorder; after it, only a newly placed item can draw `draft/question-archived` (#75). PR4's "Archived in bank" badge and frozen-draft copy are removed by PR5, since under #75 there is no archived state to show.

**Track 7 — respondent app.** No router; a state machine after one entry URL. Plain `fetch`, TanStack Form, `localStorage` partials including hidden items, filtered to visible once at submit. Storage-first resume. Client-side date validation against the **browser's** local date. The primitives' sizes are used as they are; the prototypes' larger touch scale is deferred (#63).

- Partials live under `qp:respondent:<questionnaireId>` in an envelope with a `formatVersion`, shape-checked on load; a mismatched or corrupt value is discarded, not a crash (#71)
- A successful submit clears the stored answers and keeps `{ sessionId, questionnaireId }`, so reopening the link shows the receipt (#70)
- `409 session/already-submitted` fetches `GET /sessions/:id` and shows the recorded receipt with a note, never a dead end (#72)
- Network failures on any of the three calls get a manual retry; submit is disabled in flight; stored answers survive until a genuine `2xx` (#73)
- **Not in scope: "start over"** on a resumed session, though `RespondentStart` draws it — punted as [gh#35](https://github.com/kenziesimpson/questionnaire-platform/issues/35) (#74)

#### How Track 7 runs

Four **stacked** PRs, staged on a **`staging/track-7`** branch cut from `main` after the Wave 3 contract commit merges. Each PR targets `staging/track-7`, or the PR below it in the stack, and CI runs on every pull request whatever the base branch. `staging/track-7` merges to `main` once, when all four are in, with CI green on its head. **H4** is done by hand against it.

Each PR adds its own [[8-testing#7. Test case enumeration]] rows with the feature. There is no separate integration PR.

1. [x] **Execution client and storage.** A typed `fetch` for the three `/api/run` routes; the partials storage module with its envelope and shape check (#71); Vitest and RTL set up for `apps/respondent`
2. [x] **State machine and happy path.** Start, resume, fill with branching, a client-side validation pre-check, submit only the visible answers, the receipt, and the closed and not-found screens
3. [x] **Submission errors.** The `422` mapped through `errorsByItemId`, an error summary with jump-to-item links, focus on the first invalid item, and the `409 session/already-submitted` handling (#72)
4. [x] **Network failure and retry** (#73)
5. [x] `staging/track-7 → main` merged with CI green on its head

### Wave 3b — observability and pipeline

**Track 8 — telemetry.** OTel end to end, the Collector seam, domain events as paired log and counter, the `/api/telemetry` ingest with `sendBeacon`, the opt-in Compose profile ([[6-observability]]). The admin responses browser (Wave 3a, `/api/reporting`) is inside its scope: the `view_response` audit row and `audit.record` grant for `qp_reporting`, cursor and path masking, and the browser rules for the response screens (O14, O18 to O20). → **M7**

The work is split into lanes: Foundation (T0), Backend (B, A), Database (D), Frontend (FE), Platform (P) and Verification (V). Each row is one pull request.

| PR | Lane | Contents | Depends on | State |
| --- | --- | --- | --- | --- |
| T0a | Foundation | SDK, logger, scrub, ESM hook, Dockerfile | none | Merged (#122) |
| T0b | Foundation | Error handling (gh#16), trace id in 500 bodies, health probes `/health/live` and `/health/ready` (gh#91), shutdown flush, `problemTelemetry` | T0a | Merged (#126) |
| T0c | Foundation | Sentinel leak test harness, the CI job, the `telemetry-safety` skill. Renamed from "canary" to "response telemetry leak test" in #129 | T0a | Merged (#127) |
| T0a-hardening (#129) | Foundation | Closed span names, id-field shapes, the lint gate, a leak test on real spans | T0c | Merged (#129) |
| T0d | Foundation | The telemetry package never throws into app code: `emitDomainEvent`, the logger methods, instrument recording and `problemTelemetry` swallow and count their own failures | T0a | Merged (#139) |
| B1 | Backend | Execution spans, events (O11) and metrics; the `replayed` outcome and the `answer_rejected` cap; a small cleanup commit so `evaluateVisibility` runs once per submit | T0c | Merged (#132) |
| B2 | Backend | `/api/telemetry` ingest, lenient (O17): closed per-event browser field lists and a strict stack-frame shape (`BROWSER_STACK_FRAME`), `trustProxy` 1 and a per-address limiter (O21), and the client wire schema in `packages/shared` | B1 | Merged (#133) |
| B3 | Backend | Definition spans, events after commit, audit trace ids | B2 | Merged (#134) |
| B3b | Backend | Exact counts when a rejection list is capped: `questionnaire.answers.rejected` and `questionnaire.publish.rejections` add each code's real share through `countBy`, the per-item lines stay capped and log-only, and the outcome events carry `findingCount` and `omittedCount` | B3 | Merged (#142) |
| B4 | Backend | Reporting spans, the `view_response` audit row and migration 0020 (O14, O18) | B3 | Merged (#135) |
| A1 | Backend | Harden `audit.record` so `qp_reporting` can only record `view_response`: a `session_user` check inside the function, in a new migration. The stronger alternative is a dedicated `audit.record_view_response` function granted only to `qp_reporting`, which deviates from O14's wording and needs a decision amendment. Built as the `session_user` check (`0022`); `session_user` was verified sound, so the alternative was not needed | B4 | Merged (#149) |
| D1 | Database | `pg` instrumentation extension, SQL-comment trace ids, `application_name` per pool, pool metrics. Also closes the leak test's known `pg` hole: the leak flows run with the `pg` instrumentation on and plant the sentinel as a SQL parameter (a questionnaire title, an answer), and assert no `pg` span, attribute or metric label carries it (`enhancedDatabaseReporting` stays off) | T0c | Merged (#144) |
| D2 | Database | Postgres logging config (`log_parameter_max_length=0`, `log_error_verbosity=terse`), `pg_stat_statements` (O16), the `qp_monitor` role and a `monitor.*` migration; `listSessions` joins the slow-query review (O20) | none | Merged (#145) |
| FE0 | Frontend | `@qp/telemetry/browser`: a transport-agnostic queue, message-free error capture, a hand-built `traceparent` (O12) | T0a | Merged (#131) |
| FE0b | Frontend | Wire the FE0 queue to B2's envelope: map `{level, message, attributes}` onto `{name, at, fields}` in one place and stamp `at` at enqueue; `frames.ts` imports B2's `BROWSER_STACK_FRAME` instead of duplicating the frame shape; the beacon path sends a `Blob` typed `application/json` and keeps to a byte budget (a beacon batch over about 64 KB loses everything, and an oversize body is a 413 that loses the whole batch, `session.abandoned` included); `resetLogging` restores the previous sink; a separate `beaconed` counter | FE0, B2 | Absorbed: the envelope mapping landed with B2 (#133) and the rest with FE1 (#150) |
| FE1 | Frontend | Respondent: trace headers through `injectTraceHeaders` (accepting `Headers` and array inputs), abandonment beacon, page-speed metrics, errors. Tracing was opt-in so the respondent bundle shipped `sdk-trace-web` only when used; C2 removed it for a page trace id (O24); a type-level test that a DOM `Window` is assignable to `PageWindow` | FE0b | Merged (#150) |
| FE2 | Frontend | Admin: query hooks, errors, screens named by route template; the response-detail screen reports type and stack frames only; the O20 component test. The response-detail query sets `staleTime` and `refetchOnWindowFocus` so a refocus does not write another `view_response` audit row | FE0b | Merged (#151) |
| P1 | Platform | The Collector, the Compose `observability` profile (O15), nginx. Also: a backend Compose healthcheck (the image has no `curl`, so a `node`-based or `wget` probe against `/health/ready`); a JSON nginx access log carrying `$http_traceparent` (nginx has no `log_format` or `access_log` today) that masks session ids in paths and the `cursor` query parameter (O13, O19); `.env.example` and Compose passthrough for the OTLP variables | T0b | Merged (#143) |
| P2 | Platform | Dashboards and the six O10 alerts | P1, D2 | Merged (#147) |
| V1 | Verification | The full leak test (a planted value read back through `listSessions`, `getSessionDetail` and the admin detail screen, plus Postgres's own log), trace continuity, H7 (which also checks the audit row), and the final docs reconciliation (docs/6 §2 to §6 against what shipped). As built: the backend leak flows for the response-browsing path (the admin screen is FE2's component tests), tests that read Postgres's own log and prove what validation keeps out of it, the two gaps they found closed in the schemas (integers bounded at the `integer` maximum, dates and timestamps to years 1 to 9999 and real calendar values, a decimal length, no null character), trace continuity from a `traceparent` header to the spans, log lines, exported log record and SQL comment, the docs of Track 8 reconciled with the code, and H7 rewritten to what a person can verify | All of the above | In review (this PR) |

B1 to B4 merged bottom-up. FE0b never had a pull request of its own: its envelope mapping went into B2 and the rest into FE1. Every lane PR extends the leak test for its new code paths (the `telemetry-safety` skill, `.claude/skills/telemetry-safety/SKILL.md`).

**Track 9 — end-to-end and CI.** Three Playwright specs, one command via Vitest `projects`, the end-to-end CI job alongside the jobs from [[#Gate C — CI before Wave 2]], the sentinel leak test its own job. → **M8**, **M9**

### File ownership

> **Deprecated.** Every track has merged, so this table and the "Contended" list below no longer describe reality. See [[11-structural-refactor#2. File ownership during the pass]] for current ownership.

| Path | Track |
| --- | --- |
| `packages/shared/**` | 1 |
| `apps/backend/drizzle/**`, `apps/backend/src/db/**`, `db/init/**` | 2 — **except** `apps/backend/src/db/definition/**`, which passes to Track 4 for Wave 2 (split in [[#Track 4 file split]]) |
| `apps/backend/src/app.ts`, `apps/backend/src/index.ts`, `apps/backend/src/http/**` | 4 (G0). Track 5 adds its module's registration and pool to `app.ts` and `index.ts` and may extend `src/http`, keeping G0's exports working |
| `packages/ui/**` | 3 |
| `apps/backend/src/modules/definition/**` | 4 |
| `apps/backend/src/modules/execution/**` | 5 |
| `apps/admin/**` | 6 |
| `apps/respondent/**` | 7 |
| `packages/telemetry/**`, collector config | 8 |
| `e2e/**`, CI workflows | 9 |
| `docs/**`, `README.md`, `.claude/skills/**` | nobody — a doc-only pass, never a build agent. **One carve-out:** a track appends its own rows to [[8-testing#7. Test case enumeration]] and touches nothing else under `docs/` |

**One Wave 3 crossing:** the gh#17 fix ([[2-design-doc#17. Decisions Log]] #75) changes `apps/backend` on `staging/track-6`, by explicit user authorisation, which also covered `packages/shared`; its draft validator needed no change, since validate and publish pass it no archived question ids for a stored draft's existing placements. It is not a transfer of ownership; nothing else in Track 6 touches either.

**Contended:** root `package.json`, `tsconfig.base.json`, `docker-compose*.yml`, `.env.example`, the Vitest root config. Changed in Wave 1a and Track 2 only; any later track files a request rather than editing.

### Stop and ask

An agent must not decide these alone. The first five blocked Wave 3 and are all closed; `publishedBy` is deferred with authentication and no longer blocks anything.

- [x] Admin list sort and filter UI — resolved: client-side "most recently edited" only, nothing else ships in Wave 3. [[2-design-doc#17. Decisions Log]] #53, [gh#21](https://github.com/kenziesimpson/questionnaire-platform/issues/21) tracks the fuller sort/filter surface
- [x] Which control renders each of the five response types — already settled in [[10-frontend#3. `packages/ui` — primitives and the renderer]]; this plan just hadn't caught up. The *authoring* widget for options was separate and is resolved below
- [x] The draft editor's publish-validation error surface — resolved: a summary panel with jump-to-item links for the first pass. [[2-design-doc#17. Decisions Log]] #54, [gh#22](https://github.com/kenziesimpson/questionnaire-platform/issues/22) tracks inline per-item rendering as a follow-up
- [x] How `errorsByItemId` is built from the RFC 9457 body — resolved: one function in `packages/ui`, used by both apps, dropping `answer/not-visible` and `answer/unknown-item` for now. [[2-design-doc#17. Decisions Log]] #55, [gh#23](https://github.com/kenziesimpson/questionnaire-platform/issues/23) tracks revisiting the two dropped codes
- [x] The question editor's constraint fields per response type — resolved: the `QuestionFields` prototype, with the six cross-field rules unrepresentable in the controls. [[2-design-doc#17. Decisions Log]] #58
- [ ] ~~**`publishedBy` has no column** (blocks G3's `VersionSummary`).~~ **Deferred with authentication, not resolved** — [[2-design-doc#17. Decisions Log]] #64. `publishedBy` stays `null` and the admin history screen renders it as absent. Not blocking. The original question: `questionnaire_version` stores `created_by`, which is whoever opened the draft, and `qp_definition` cannot read the publish row in `audit.event`. Filling `publishedBy` from `created_by` would label the draft's opener as the publisher; adding a `published_by` column needs a migration and a change to `promote_draft`
- [ ] Anything that would add a custom migration, widen a grant, put an unpersisted value in the digest, or change what crosses the definition/execution boundary

**The same design pass also settled one item not originally on this list:** the options-authoring widget (add/remove/reorder/mark-freeform) for `single_choice` and `multiple_choice` questions follows the `AdminQuestionEditor` prototype — drag to reorder, generated option ids shown and locked, freeform "Other" marked on its row ([[2-design-doc#17. Decisions Log]] #58). Both design items are resolved; nothing in Wave 3 waits on them.

### Agent-verified milestones

A wave is not done until its milestones are green.

- [x] **M1** Engine units: branching truth table, every operator against every type, unanswered → `false`, digest determinism under key reordering, timezone cases
- [x] **M2** DB invariants on Testcontainers: `UPDATE` and `DELETE` on published rows rejected; bad `response_shape` rejected; `qp_execution` denied on authoring tables; `qp_definition` denied on `response` and on `audit.event`; audit reachable only through `audit.record`; no-default-partition behaviour
- [x] **M3** Renderer components plus the axe check; reveal and removal announced via `aria-live`
- [x] **M4** Definition API via `inject()`: bank CRUD, stale-ETag `409`, publish happy path, publish failures as `422`, archived question rejected at add time, version history, deterministic list order
- [x] **M5** Execution API via `inject()`: session pins the snapshot and ignores a later publish; resume; submit; idempotent replay returns the original receipt; answer to an invisible item `422`; the v1/v2 predicate-tightening fixture; closed questionnaire `409`
- [x] **M6** Cross-version aggregation: v1 and v2 responses aggregate on `opt_hyperten` while each renders through its own pinned `questionVersion`
- [ ] **M7** Telemetry sentinel leak test: a planted answer value reaches no exporter, on the submit path and when read back through `/api/reporting` (list and detail) and the admin response-detail screen
- [ ] **M8** Three Playwright specs against the composed stack
- [ ] **M9** Whole suite, one command, headless, every CI job green from a clean clone

### Manual checkpoints

The things a green test cannot tell you.

- [ ] **H1** *(after Track 2)* `docker compose up` from clean; then open `psql` and try to `UPDATE` a published snapshot yourself. Feel the barrier rather than trusting a green test
- [ ] **H2** *(after Track 2)* Read the generated migration SQL by hand. [[9-database-schema#11. Migrations]]'s traps fail *silently*, and generated SQL is where they survive review
- [ ] **H3** *(after Waves 2)* Drive the API by hand through the demo flow once and read the problem+json bodies. Shape and wording are judgement, not assertion
- [ ] **H4** *(after Track 7)* Fill the demo questionnaire in a browser: answer yes, watch the branch appear; switch to no, watch it and its answers disappear; reload and resume; submit and confirm the stored answers are gone while the session id remains, then reopen the link and see the receipt
- [ ] **H5** *(after Tracks 3, 6, 7)* Keyboard-only pass on both apps, then a screen reader on the reveal/remove announcement and on a dnd-kit reorder. No automated check covers this, and it is the accessibility claim the medical domain rests on
- [ ] **H6** *(after Track 6)* Author from the bank, reorder by keyboard, set a predicate, preview, publish, read version history. Then open a second tab and provoke the draft `409` deliberately
- [ ] **H7** *(after Track 8)* Enable the opt-in profile, submit once, follow the backend trace of that submit from the page's client trace id to its database statements and its joined logs, and confirm no answer value appears in any trace, log or metric. Then open the response in the admin app and confirm the detail read wrote exactly one `view_response` audit row, that a window refocus wrote no second one, and that no answer value appears in the read's trace or logs. The browser creates no span ([[6-observability#6. Client-side telemetry]], O24), so there is no client span to follow in Tempo, and the browser's trace id is a correlation id and not a parent: each request is a backend trace of its own, and the client side is the `client.trace_id` attribute on that trace's `request` span, the `client_trace_id` on its log lines and the `trace_id` in nginx's access-log line, which are all the same page trace id.

  **Set up.** This is the observability profile, which is not the default.
  1. `cp .env.example .env`, and in `.env` set `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318`.
  2. Start it: `docker compose -f docker-compose.yml --profile observability up --build`. Wait for the `lgtm` container to accept traffic, tens of seconds; the first exports after a cold start may be dropped ([[6-observability#11. Local and hosted setup]]). Nothing about the frontend build changes: every build sends the page's `traceparent`.
  3. Open the respondent at http://localhost:8080 and fill in the intake questionnaire, typing a marker you can search for, such as `h7marker4172`, into the pharmacy answer and into "Other" on the condition question. Submit. Open Grafana at http://localhost:3001 (no login).

  **Follow the trace** ([[6-observability#11.3 Following one request in Grafana]]).
  1. Explore, the Tempo data source, TraceQL: `{ span.client.trace_id != nil }`. Open the trace for `POST /api/run/sessions/:sessionId/submit`. Its root is the backend `request` span, in a trace of its own with a backend trace id; there is no missing browser parent. Under it are the handler, `session.submit`, `rule.evaluate` and the `pg.query:` spans of the submit's transaction. Note the backend trace id, and the `client.trace_id` attribute on the `request` span: 32 hex digits, different from the trace id.
  2. Find the page's other requests: `{ span.client.trace_id = "<the client trace id>" }` returns one trace for each request the page made (the session's creation, and this submit), each with its own backend trace id and the same client trace id. `docker compose -f docker-compose.yml logs frontend` shows the nginx line for the submit with a `trace_id` equal to the client trace id. (Read the nginx log with `docker compose logs`; `tail` on the file inside the container blocks.) The Client page view dashboard shows the same traces and the log lines when the id is pasted into its variable.
  3. Explore, the Loki data source: `{service_name="qp-backend"} | trace_id="<backend trace id>"`. Expect the request lines and the submit's events, `session.question_answered`, `session.completed` and `session.submit_finished`, each with the backend trace id of step 1 and the `client_trace_id` of step 2. `{service_name="qp-backend"} | client_trace_id="<client trace id>"` returns the lines of every request of the page.
  4. Open the Respondent funnel dashboard (folder "Questionnaire platform"): "Started" and "Completed" and "Submissions by outcome" (an `accepted`) moved by one.

  **Confirm no answer anywhere.** Each search for the marker finds nothing.
  1. In the trace of the submit, open the `request`, `session.submit` and `pg.query:` spans and read their attributes: ids, a route template, a status and a duration, never the marker.
  2. Loki: `{service_name="qp-backend"} |~ "(?i)h7marker"` returns nothing.
  3. Prometheus (Explore): the label browser lists no label value containing the marker, and the `questionnaire_*` series carry only the bounded labels of [[6-observability#7. Cardinality and metric hygiene]].
  4. `docker compose -f docker-compose.yml logs backend db frontend collector | grep -i h7marker` prints nothing: the backend's stdout, the Postgres log, nginx's access log and the Collector.
  5. The database is the one place the marker is: `docker compose -f docker-compose.yml exec db psql -U questionnaire -d questionnaire_platform -c "SELECT text_value, other_text FROM execution.response"` shows it (the defaults of `.env.example`).

  **The admin read and its audit row.**
  1. `docker compose -f docker-compose.yml exec db psql -U questionnaire -d questionnaire_platform -c "SELECT count(*) FROM audit.event WHERE action = 'view_response'"` and note the number, N.
  2. Open http://localhost:8080/admin/, the intake questionnaire's Responses, and that response. The answers, including the marker, are on the screen. Run the count again: N + 1, and `SELECT actor_id, summary, trace_id FROM audit.event WHERE action = 'view_response' ORDER BY occurred_at DESC LIMIT 1` shows the session id as the whole summary, and no answer.
  3. Switch to another window or tab and back, wait a few seconds, run the count: still N + 1. A focus or reconnect does not read the response again ([[10-frontend#5.5 Telemetry]]). Reloading the page, or opening the response again, is a new read and writes one more row.
  4. Find the read's trace in Tempo by the row's `trace_id` (the TraceQL tab accepts a trace id, or use the query of step 1 of "Follow the trace" and pick the `GET /api/reporting/questionnaires/:id/responses/:sessionId` trace; its audit row holds the backend trace id, not the client's). It holds a `reporting.session_detail` span with the questionnaire and session ids, and the Loki query of step 3 shows `reporting.response_viewed`. Repeat the marker searches: nothing.
  5. The Admin and authoring dashboard's "Response list and detail reads" shows one more detail read. Alerting, Alert rules lists the groups "Questionnaire platform, O10" (six rules) and "Questionnaire platform, client" (three): none should be firing on a stack this quiet.

  **Trace and log join, in short.** For any backend request: (a) the Tempo trace id, (b) `{service_name="qp-backend"} | trace_id="<id>"` in Loki returns its log lines and each line's span id is one of the trace's spans, (c) the `request` span's `client.trace_id` is the `client_trace_id` on those lines and the `trace_id` of nginx's line for the request, and (d) a statement in `pg_stat_activity`, read within ten seconds of the request because the pool closes idle connections after that (`docker compose -f docker-compose.yml exec db psql -U questionnaire -d questionnaire_platform -c "SELECT application_name, left(query, 160) FROM pg_stat_activity WHERE application_name LIKE 'qp-backend:%'"`), ends in `/*traceparent='00-<backend trace id>-<span id>-01'*/`, whose span id is a `pg.query:` span of the trace and whose trace id is the backend's, never the client's. The same join runs without Grafana in `apps/backend/_tests/trace-continuity.test.ts`.

  Tick the box only after a person has done this once. It stays open until then; CI does not run it.
- [ ] **H8** *(end)* Fresh clone, follow the README only, see whether it works. Then read [[2-design-doc]] the way a reviewer will
