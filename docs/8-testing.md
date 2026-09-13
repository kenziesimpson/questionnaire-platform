# Testing — Detailed Design

> Detail doc for [[2-design-doc#15. Testing]]. The design doc carries the condensed version; this is the layer-by-layer reasoning, the database strategy, the pipeline shape and the decisions behind them.
> Related: [[5-questionnaire-format]] (the rule engine and publish-time validation under test), [[7-application-boundary]] (the barrier the integration layer proves), [[6-observability#3. Respondent answers must never enter telemetry]] (the canary sentinel test), [[2-design-doc#13. Deployment]] (the compose stack end-to-end runs against).

## 1. What we are optimizing for

The brief asks for "automated tests on important domain behavior — **versioning and conditional navigation above all**." Tests are a graded deliverable here, not hygiene, which changes what the suite is for: it exists to make the design's claims checkable by someone who has not read the code.

So the organizing question for each test is *which claim does this make falsifiable?*

| Question a reviewer will ask | Layer that answers it |
| --- | --- |
| Does branching pick the right next question, for rules over several earlier answers? | Rule-engine unit tests (§2.1) |
| Is a published version *really* immutable? | Integration test that bypasses the API and writes to the database directly (§2.2) |
| Do responses collected under v1 still mean what they meant once v2 publishes? | Integration test across a publish boundary (§2.2) |
| Is the definition/execution boundary real or just a URL prefix? | Plugin-isolation test + a grant test that asserts `qp_definition` cannot read `response` (§2.2) |
| Does the whole workflow actually work? | One Playwright spec per graded flow (§2.4) |
| Can a respondent's answer leak into telemetry? | The canary sentinel test (§2.5) |

Three invariants are load-bearing, and every layer below exists to defend one of them:

1. **A published version is immutable.** Enforced in three places ([[2-design-doc#6. Versioning & Immutability]]), so it needs a test per place, not per code path.
2. **A response's meaning is pinned to the version it was collected under.** Stable option ids and `{ value, unit }` are only guarantees if something checks them across a republish.
3. **The server is the authority on the reachable path.** The client evaluates branching locally for interactivity; if the two evaluators can disagree, the server's answer is the one that must hold.

**Explicit non-goal: a coverage percentage.** A number would be satisfied by testing the easy surface — serializers, config, getters — and the graded behavior is concentrated in a small amount of intricate code. Coverage is collected and read, not gated. See §8.6.

## 2. Layers

| Layer | Runner | Needs | Speed | Count |
| --- | --- | --- | --- | --- |
| Domain unit (shared package) | Vitest | nothing | ms | most of the suite |
| Backend integration | Vitest + `app.inject()` | Postgres (Testcontainers) | ~seconds | one file per route group |
| Frontend component | Vitest + RTL + jsdom | nothing | ms | the renderer and the form |
| End-to-end | Playwright | composed stack | ~tens of seconds | three specs |

### 2.1 Domain unit — the shared package

The rule engine, publish-time validation, the snapshot `formatVersion` upgrade, and the answer canonicalization behind the submit digest ([[2-design-doc#17. Decisions Log]] #19) are all pure functions in `packages/shared`. No Fastify, no database, no fixtures beyond literals.

**The shared package means this is tested once and exercised twice.** Client and server run the *same* evaluator, so a single suite covers both — a property of the architecture rather than a testing convention. Two evaluators would need two suites and could still drift in the gap between them.

Table-driven with `it.each`, because the input space is a product of small sets rather than a list of scenarios:

- Every operator against every response type it is defined for, plus the negative cases the discriminated union is supposed to make unrepresentable (a date operator against a number answer should not compile; a test asserts the type error via `@ts-expect-error` so the guarantee is visible rather than implied).
- **Absent-answer semantics:** a condition on a question that was not shown is `false` for every operator. This is the rule most likely to be broken by a well-meaning refactor and the cheapest to pin down.
- `all` / `any` grouping, including the single-condition and empty-group edges.
- Publish-time validation: forward references, domain-intersection satisfiability, referential integrity ([[5-questionnaire-format#5. Publish-time validation]]).
- The **medical-condition demo** as explicit cases — see §3.

### 2.2 Backend integration — Fastify `inject()` against a real Postgres

**`app.inject()` is the whole technique.** Fastify's built-in `light-my-request` integration runs a synthetic request through the complete lifecycle — hooks, schema validation, handler, serializer, error handler — in-process, with no socket and no port. Route tests end up as fast as unit tests and need no lifecycle management beyond `await app.close()`.

The one prerequisite is that `apps/backend/src/index.ts` splits into a `buildApp(opts)` factory and a thin `server.ts` that calls `listen()`. Worth doing regardless: it is also what lets a test build an app with one plugin registered and nothing else.

**Plugin encapsulation is the test boundary.** Registering only the execution plugin on a bare Fastify instance and driving a session to submission proves the execution half needs nothing from the authoring half — which is the boundary claim in [[7-application-boundary#3.1 Module encapsulation]], mechanically checked instead of asserted. The reverse direction is a lint rule; this is the runtime half of the same argument.

**The database is real, and not mocked.** The invariants under test *are* database objects:

| Under test | Database object |
| --- | --- |
| Republishing a frozen version fails | The immutability trigger |
| At most one draft per questionnaire | The partial unique index |
| The audit trail cannot be rewritten | `qp_definition`'s zero grant on `audit.event`, behind the `SECURITY DEFINER` `audit.record()` function |
| Authoring cannot read medical answers | `qp_definition`'s missing grant on `response` |

A mocked repository passes every one of those with the constraint absent, which makes it worse than no test. `pg-mem` is out for the same reason at one remove: triggers, roles and the JSONB operators the snapshot index relies on are exactly what it does not faithfully implement. Strategy in §4.

The three-layer immutability story ([[5-questionnaire-format#6.4 Three layers of immutability enforcement]]) is exercised here, and the third layer *is* this test. **API 409** via `inject`, the **database trigger** via a direct client bypassing the API entirely — and that bypass is layer three, the one place a test deliberately goes around the application, and the reason the guarantee cannot silently regress when the service layer is refactored. Draft uniqueness is a separate invariant with its own row above, exercised by two concurrent draft creations.

### 2.3 Frontend component — Vitest + React Testing Library

Vitest rather than Jest, despite Jest being the more familiar tool here: Vitest reads the existing `vite.config.ts`, so there is one transform and module-resolution config in the repo instead of two, and ESM and TypeScript need no additional plumbing. The authoring API is Jest's — `describe`/`it`/`expect`, `vi` where Jest has `jest` — and React Testing Library sits on top unchanged. `jsdom` as the environment. See §8.1.

Worth testing at this layer: each response type's input renders and reports its value; required-ness produces the validation message; the next-question decision the UI makes matches the shared engine — imported, not reimplemented, so the test cannot encode a second opinion about branching.

Not worth testing here: layout, styling, and anything §2.4 covers better by exercising the real stack.

### 2.4 End-to-end — Playwright against the composed stack

Playwright runs against `docker compose up` through nginx, so what is under test is the artifact a reviewer will run: production images, the proxy, and the `migrate` service gating `backend`. CI must use `docker compose -f docker-compose.yml` explicitly, or the committed dev override swaps in the Vite dev server and the test stops resembling the deliverable.

Headless, Chromium only. Cross-browser coverage is not what this suite is for.

**Three specs, deliberately.** End-to-end tests are where suites rot, and each one here is chosen because it is the only layer that can prove its claim:

1. **The mandatory branching demo.** Author a questionnaire, publish it, answer *yes* to the medical-condition question and get the condition and diagnosis-date questions; a second session answering *no* skips both and lands on the next common question.
2. **Resume.** Abandon a part-finished session, return, and continue from where it stopped with prior answers intact.
3. **The v2 publish boundary.** Publish a second version, then confirm the v1 response still renders with v1's prompts and still aggregates on `questionId`.

Spec 1 drives the admin UI for authoring, because authoring *is* what it is testing. Specs 2 and 3 seed through the definition API in a fixture — clicking through authoring to arrange a precondition is the main way these suites become slow and brittle.

Queries use `getByRole` and `getByLabelText` rather than test ids wherever the accessible name exists, which makes the form's labelling a tested property as a side effect.

### 2.5 The telemetry canary — cross-cutting

Already decided in [[6-observability#3.1 Enforcement ladder]] (Layer 2) and restated here because it lives in this suite and gates CI: the harness installs an in-memory span exporter and pino destination, runs the branching flow with a sentinel answer value, and asserts the sentinel appears in zero spans, zero log records and zero metric attributes.

Its value is that it rides on whatever the integration suite already exercises, including paths added after it was written — the property grep-based checks cannot have.

## 3. Required coverage — the graded list

Each capability the brief grades, and the layer that proves it. This table is the argument that the suite is complete; §7 is where it becomes individual cases.

| Behavior | Layer |
| --- | --- |
| Questionnaire versioning: publish, immutability, one draft | Integration (§2.2), three layers |
| Question versioning: append-only, items pin a version at add time | Integration |
| Conditional navigation over one *and* several earlier answers | Unit (§2.1), exhaustive |
| Absent-answer semantics | Unit |
| Publish-time rule validation: forward refs, unsatisfiable conditions | Unit |
| Response validation: required, per-type value rules | Unit + integration (edge rejection) |
| Sessions: start, resume, version pinning | Integration + E2E spec 2 |
| Submit idempotency: same digest replays, different digest conflicts | Integration |
| Server as authority: an answer to an unreachable item is rejected | Integration |
| Path re-evaluation uses the *pinned* definition, not the latest published | Integration (§6, predicate-change fixture) |
| Retirement: start and submit rejected past `closes_at` | Integration, with frozen time |
| Response meaning preserved across a republish | Integration + E2E spec 3 |
| No respondent answer in telemetry | Canary (§2.5) |
| The definition/execution barrier | Plugin isolation + grant test (§2.2) |
| Duplicate `option_ids` inside one answer — rejected by the submit validator, **not** by a constraint | Unit + integration. The one `response` invariant not enforced below the application ([[2-design-doc#17. Decisions Log]] #34), so a test is the only thing holding it |
| Relative date constraints across a timezone boundary | Unit. The evaluator takes `today` as a parameter, so client-local and server-UTC-plus-tolerance are both plain cases with no clock to mock ([[5-questionnaire-format#2.4 Relative date constraints resolve against two different clocks]], #38) |
| List endpoints return a deterministic order | Integration. Unspecified order is heap order and shifts after an `UPDATE`, which is what makes list assertions flaky rather than merely unordered ([[2-design-doc#17. Decisions Log]] #40) |

**The mandatory demo scenario is tested at two layers on purpose.** The brief asks for automated tests covering it specifically; the rule-engine cases cover it exhaustively and in milliseconds, and one Playwright spec proves the same thing is true of the running system. Neither alone is a satisfying answer to "show me it works."

## 4. Postgres for integration tests — Testcontainers

**Decision:** `@testcontainers/postgresql` starts one `postgres:16-alpine` container (matching compose) in a Vitest `globalSetup`. Migrations run once into a template database; each Vitest worker then creates its own database from that template.

```sql
CREATE DATABASE qp_test_3 TEMPLATE qp_test_template;
```

Three things fall out of that shape:

- **`npm test` stays one command.** No `docker compose up` first, no README step that only applies to contributors, and CI behaves identically to a laptop.
- **Parallelism survives.** Vitest runs test files in parallel workers. One shared database plus `TRUNCATE` between tests means workers clobber each other's rows mid-test; a database per worker is real isolation. `CREATE DATABASE ... TEMPLATE` is close to instant and skips re-running migrations per worker, so the isolation is nearly free.
- **Within a worker**, `TRUNCATE ... RESTART IDENTITY CASCADE` between tests. Wrapping each test in a transaction and rolling back is tidier in the abstract but breaks precisely where the important tests are: the publish path opens its own transaction and takes row locks, and the immutability bypass test needs a second connection that can see committed state.

**The roles come from the same script compose uses.** The container needs `qp_owner`, `qp_definition`, `qp_execution` and `audit_owner` before migrations run, and it never executes compose's `docker-entrypoint-initdb.d`. `globalSetup` runs `db/init/01-roles.sh` inside the container with `execInContainer` — the same file, not a copy, because a reimplementation would let the grant tests in §3 pass against roles that differ from what ships ([[9-database-schema#11.3 Roles are not schema, and must not be in a committed migration]]).

**Escape hatch, and it is not only a convenience:** if `TEST_DATABASE_URL` is set, the suite uses it and skips the container entirely. It must be an **admin** URL — a role that can create databases, such as the bootstrap superuser of a throwaway instance whose roles `db/init/01-roles.sh` has already created. The suite uses it only to create the template and per-worker databases, owned by `qp_owner`. Migrations still run as `qp_owner`, using `QP_OWNER_PASSWORD`, so default privileges attach to the principal that creates the tables, and neither application role nor the shipped `qp_owner` needs `CREATEDB`. That makes the suite portable to any CI that can supply a Postgres service container but not a Docker socket (§5.3), and locally it points at the compose `db` for a faster inner loop.

Stated honestly in the README: the default path needs a running Docker daemon.

## 5. Running headless — local, PR, deploy

### 5.1 One command

A root `vitest.config.ts` with `projects: ['packages/*', 'apps/*']` makes `vitest run` at the repo root execute the shared, backend and frontend suites together, each with its own environment. (Vitest 5 configures this in the root config; the standalone `vitest.workspace.ts` file no longer exists.)

- `npm test` → `vitest run`. Non-watch, proper exit code, no browser.
- `npm run test:e2e` → `playwright test`, deliberately separate. Playwright is not a Vitest project and folding it in would make the fast suite as slow as the slow one.

### 5.2 Pipeline shape

Two jobs, so a typo does not wait on an image build:

1. **Checks** — `lint`, `typecheck`, `vitest run`. Testcontainers supplies its own Postgres, so the job needs no service definition. The telemetry canary gates here.
2. **End-to-end** — build images, `docker compose -f docker-compose.yml up -d --wait`, `playwright test`.

`--wait` blocks until healthchecks pass, which is only as good as the healthchecks: `db` has one today, `backend` and `frontend` do not, so `--wait` currently proves those containers started rather than that they serve. Adding a `backend` healthcheck on `/health/ready` — which [[6-observability#8. SLOs and alerting]] wants for the Kubernetes probes anyway — is what makes step 2 deterministic instead of racy.

### 5.3 CI details that actually bite

- **Testcontainers needs a reachable Docker daemon.** Standard hosted Linux runners have one and need no extra configuration. Daemonless or Kubernetes-based runners need docker-in-docker or a remote Docker host. Testcontainers also starts a *Ryuk* reaper sidecar to clean up orphaned containers; where sidecars are disallowed, `TESTCONTAINERS_RYUK_DISABLED=true`. Pin the image tag so pulls cache rather than resolving a moving tag on every run.
- **Playwright browsers** come from either `npx playwright install --with-deps chromium` or the official Playwright container image — whose tag must match the installed Playwright version exactly, since the image ships the browsers that version expects.
- **Flake control:** retries in CI only, `trace: 'on-first-retry'`, `reducedMotion: 'reduce'`, and `playwright-report/` uploaded as a job artifact. The trace viewer turns a red pipeline into a DOM timeline of the failure, which is most of why Playwright is worth the setup (§8.5).
- **CI is the gate.** The `lefthook` pre-commit hook running lint and typecheck on staged files is convenience, because `--no-verify` exists — the same position [[6-observability#3.1 Enforcement ladder]] takes.

### 5.4 The end-to-end suite is also the deploy smoke test

The specs need only a `baseURL`, so the same three can run against a deployed environment after a rollout. That is the honest answer to "how would this work in Kubernetes" — a post-deploy job, not a second suite — and it is the same code the synthetic canary in [[6-observability#12. Change correlation and synthetics]] would put on a timer.

## 6. Test data and fixtures

- **The seeded demo questionnaire has one definition**, a builder in `packages/shared` used by both the `migrate`/seed container and the test fixtures. If the demo that ships and the fixture under test are separate literals, they drift, and the drift surfaces as a passing suite over a broken demo.
- **Factories, not fixture files.** Small builders with overrides — `aQuestionnaire({ items: [...] })` — so each test states only what it varies. Randomized data stays out of assertions; deterministic seeds only.
- **Freeze time** (`vi.setSystemTime`) for the `closes_at` cutoff tests. Nothing sleeps.
- **The telemetry sentinel is an exported constant**, not a string retyped per test, so the canary cannot pass because someone fixed a typo.
- **A predicate-change fixture, kept separate from the seeded demo.** The demo's version 2 is a relabel and deliberately does one thing ([[5-questionnaire-format#3.1 Version 2 — the demo change]]), which means its two versions have an identical reachable path — so it cannot prove that submit evaluates against the *pinned* definition rather than the latest. That claim gets its own two-version fixture, where v2 tightens `itm_03`'s predicate to `all: [ has_condition is yes, which_condition is not other ]`:
  - a session started **before** the publish, pinned to v1, submits `yes` / `other` / a diagnosis date and is **accepted** — the date is required on v1's path;
  - a session started **after** it, pinned to v2, submits the identical answers and is **rejected** `422` for an answer to an unreachable item, naming `itm_03` and never echoing the date ([[7-application-boundary#5.5 Error bodies must not echo answers]]).

  Same answers, opposite outcomes, and the only variable is which snapshot the session pinned. This is also the cheapest test of the republish-while-in-flight claim in [[2-design-doc#8. Sessions & Responses]].

## 7. Test case enumeration

**Empty — to fill in during the build.** One row per case, grouped by the layers in §2, each naming the invariant it defends and the requirement from §3 it discharges. Written alongside each feature rather than afterwards, per the repo's standing rule that a versioning or branching change arrives with its test.

Tracked as a Phase 2 item in [[4-implementation-plan]].

### Wave 1a — the contract

**Domain unit — `packages/shared`**

| Case | File | Invariant defended | §3 row |
| --- | --- | --- | --- |
| The documented v1 snapshot validates as `PublishedDefinition` | `domain/schemas.test.ts` | The format in [[5-questionnaire-format#3. Serialization]] is what the schema accepts | Response meaning preserved across a republish |
| The v2 relabel (question version 4, same `opt_hyperten` id) validates | `domain/schemas.test.ts` | #26: v2 differs by one label and nothing structural | Response meaning preserved across a republish |
| Snapshot rejects `formatVersion` 2, `yes_no`, a `questionId`-keyed condition, `question.key`, a slug `questionnaireId`, a nested predicate, a mistyped operator, a missing `numberKind`, an impossible date bound, an empty option list | `domain/schemas.test.ts` | A stale or corrupt snapshot fails loudly on load (§6.5); #35, #36, #41 hold at the schema | Conditional navigation over one and several earlier answers |
| Each condition type accepts its own operators and operands and rejects content matching, list/scalar operand swaps, string number operands, cross-type operands, empty option lists | `domain/schemas.test.ts` | Conditions typed per response type (#9) | Conditional navigation over one and several earlier answers |
| `@ts-expect-error`: a date operator on a number condition, a text `is`, a `questionId`-keyed condition do not compile | `domain/schemas.test.ts` | Invalid comparisons are unrepresentable, not a runtime class (#9, #41) | Conditional navigation over one and several earlier answers |
| Empty `all` / `any` groups are representable; a predicate with both keys is not | `domain/schemas.test.ts` | Single grouping level; empty-group edges stay testable for the engine | Conditional navigation over one and several earlier answers |
| A number answer is a decimal string; a JSON number, a client-sent `unit`, and non-canonical decimals (`1e3`, `01`, `+1`, `1.`, `.5`) are rejected | `domain/schemas.test.ts` | #42: exactness survives the wire; the unit comes from the pinned version | Response validation: required, per-type value rules |
| Duplicate `optionIds` pass the answer schema | `domain/schemas.test.ts` | #34: duplicates are the submit validator's `422` naming the item, not a schema `400` | Duplicate `option_ids` inside one answer |
| Empty text answer rejected; answers keyed by `itemId` slug with explicit `null` allowed, uuid keys rejected | `domain/schemas.test.ts` | #41 keying; `response_shape`'s non-empty text rule | Response validation: required, per-type value rules |
| The validated `Answer` row stores `single_choice` as a one-element `optionIds` and carries the server-filled unit | `domain/schemas.test.ts` | The digest input is exactly the persisted row (#37) | Submit idempotency |
| The yes/no template is an ordinary `single_choice` with editable labels; a save request cannot carry `questionId` | `domain/schemas.test.ts` | #36; identity is server-assigned (#13) | Question versioning |
| The problem slug set and statuses are exactly §6.1's closed union; type URIs round-trip | `problems.test.ts` | Closed slug union (#20) | — contract |
| Every constructed problem body validates against the wire schema; a body carrying an extra `value` field does not | `problems.test.ts` | Error bodies never echo an answer (§5.5 of [[7-application-boundary]]) | No respondent answer in telemetry |
| `@ts-expect-error`: `submission/invalid` without items, a draft code on a submission item, `internal` without a correlation id, an invented slug | `problems.test.ts` | Extensions are required per slug and codes cannot cross slugs | — contract |
| `Sensitive` redacts under `JSON.stringify`, template, `String()`, concatenation, `util.inspect` (`showHidden`), `util.format`, `Error` messages, spread and `Object.entries`; `unwrap()` returns the value | `sensitive.test.ts` | Layer 0 of [[6-observability#3.1 Enforcement ladder]] | No respondent answer in telemetry |
| The route table is exactly the 18 + 3 routes of [[7-application-boundary]] §4.1 / §5.1, each with `4xx` / `5xx` problem schemas | `api/api.test.ts` | Contract completeness; error serialization is contractual | The definition/execution barrier |
| No execution route path names a questionnaire | `api/api.test.ts` | #18: no unpinned definition read | Sessions: start, resume, version pinning |
| `PUT /draft` and `POST /publish` require `If-Match`; other headers pass | `api/api.test.ts` | #43: a missing header is a schema `400`, never an unconditional write | Questionnaire versioning: publish, immutability, one draft |
| Submit body keyed by `itemId` and the typed receipt validate | `api/api.test.ts` | §5.4 receipt is the session row | Submit idempotency |
| Draft ETag round-trips `W/"<versionId>:<draftRevision>"` and rejects malformed forms | `api/api.test.ts` | #43 | Questionnaire versioning: publish, immutability, one draft |

**Domain unit — `packages/telemetry`**

| Case | File | Invariant defended | §3 row |
| --- | --- | --- | --- |
| Literal messages, closed context, typed domain events and closed span names are accepted | `src/index.test.ts` | Layer 1: a typed boundary with a closed field set | No respondent answer in telemetry |
| `@ts-expect-error`: an interpolated message, a message in a `string` variable, an unknown context field, a free-text rejection reason, an invented span name | `src/index.test.ts` | No shape exists that an answer value could ride in on | No respondent answer in telemetry |

**Repo configuration — `tests/`**

| Case | File | Invariant defended | §3 row |
| --- | --- | --- | --- |
| `pino`, `pino/*`, `pino-*` and `@opentelemetry/*` (including type-only) are rejected outside `packages/telemetry`, including inside backend modules where the module rule replaces the base options; allowed inside it | `tests/lint-boundaries.test.ts` | Layer 1 lint rule | No respondent answer in telemetry |
| `modules/definition` rejects sibling, deep-relative, `modules/`-path and type-only imports of `modules/execution`, and the reverse; `@qp/shared`, in-module imports and look-alike paths pass | `tests/lint-boundaries.test.ts` | [[7-application-boundary#3.1 Module encapsulation]] | The definition/execution barrier |

### Wave 1b — Track 1: engine and validators

**Domain unit — `packages/shared`** (milestone **M1**)

| Case | File | Invariant defended | §3 row |
| --- | --- | --- | --- |
| Every operator of every response type — 22 operators, each with an answer that makes it hold and one that does not, including `between` at both inclusive ends; a guard asserts the table covers the full operator set | `engine/conditions.test.ts` | One evaluator, typed per response type ([[5-questionnaire-format#4.3 Evaluation]], #9) | Conditional navigation over one and several earlier answers |
| Number conditions compare the decimal string exactly against the authored constant: `18.00` equals `18`, `0.1` is not `lt 0.1`, `1e21` and `1e-7` operands compare beyond double precision | `engine/conditions.test.ts` | #42: exactness survives into evaluation, not only storage | Conditional navigation over one and several earlier answers |
| `conditionHolds`: unanswered → `false` for every operator except text `answered` with `value: false`; not shown with an answer kept → `false` for every operator; an answer shaped for another type → `false`; the negative operators `isNot`, `isNoneOf`, `excludes`, `neq` do not fire for a respondent who never answered | `engine/conditions.test.ts` | A condition means the answer exists and satisfies the operator (§4.3) | Absent-answer semantics |
| Text `answered` truth table over shown × answered × `value`: `value: true` holds only when shown and answered, `value: false` only when shown and unanswered, and both are `false` when the referenced item is hidden, with or without a stale answer | `engine/conditions.test.ts` | One text operator with a boolean operand; a hidden reference is `false` for both values (§4.3, option b) | Absent-answer semantics |
| Text conditions are `{ op: "answered", value: boolean }`: both values accepted; `op: "notAnswered"` (with or without `value`), a missing `value` and a string `value` rejected by the schema; `@ts-expect-error` shows `notAnswered` and a bare `answered` no longer compile | `domain/schemas.test.ts` | The collapsed text operator is the only representable form (#9) | Conditional navigation over one and several earlier answers |
| Holds implies satisfiable: for every operator-table condition, on unbounded and bounded questions of its type, if some valid candidate answer makes it hold at runtime then `isTermSatisfiable` for that single condition is `true` (and on unbounded questions every condition can hold). Verified to fail when the publish-time `isNot` encoding is broken | `engine/conditions.test.ts` | The runtime (`holds`) and publish-time (`satisfiable`) encodings of operator meaning cannot drift silently | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Traversal: every operator-table case evaluated through a gated definition gives the same result as `conditionHolds`; with the gate closed and the stale answer kept, every operator is `false`; text `answered` with `value: false` follows the gate | `engine/visibility.test.ts` | A condition on a question that was not shown is `false` (§4.3); answers to hidden items are kept client-side ([[10-frontend#4.3 Local persistence]]) | Absent-answer semantics |
| An explicit `null`, an itemId named like an `Object.prototype` key, and a reference to a later item are all treated as not answered or not shown | `engine/visibility.test.ts` | Absent-answer semantics hold for malformed and adversarial input | Absent-answer semantics |
| `all` / `any` truth table over two conditions including unanswered, single-condition groups, empty `all` → `true`, empty `any` → `false` | `engine/visibility.test.ts` | Single grouping level (§4.1); the empty-group edges are defined | Conditional navigation over one and several earlier answers |
| Demo truth table for v1 and v2: yes → `itm_01..04`; no → `itm_01`, `itm_04`; unanswered → the branch stays closed; no with stale branch answers → still skipped | `engine/visibility.test.ts` | The mandatory branching demo, and v2's identical reachable path (#26) | Conditional navigation over one and several earlier answers |
| A rule over two earlier answers: has a condition AND it is diabetes | `engine/visibility.test.ts` | Rules over *one or more* previous responses | Conditional navigation over one and several earlier answers |
| `visibleAnswers` drops hidden answers transitively, and re-evaluating the filtered payload yields the same visible set | `engine/visibility.test.ts` | Client filtering at submit and the server's re-evaluation cannot disagree | Server as authority: an answer to an unreachable item is rejected |
| Per-type answer constraints: text length in code points; unknown option; `otherText` without a freeform `other`; too few / too many counted on distinct ids; integer accepts a zero fraction (`72.0`) and rejects a non-zero one; inclusive number and date bounds compared exactly; `not_future` / `not_past`; type mismatch | `engine/answer-validation.test.ts` | Each value satisfies its pinned question version's constraints ([[7-application-boundary#5.4 Submit: authority, validation, idempotency]]) | Response validation: required, per-type value rules |
| A selected freeform `other` with missing, empty or whitespace-only `otherText` → `choice/other-text-required`, for single and multiple choice; padded text passes; whitespace-only text without `other` stays `choice/other-text-without-other`; through `validateSubmission`, missing, `""` and whitespace-only all pass the answer schema and produce the same 422 item error | `engine/answer-validation.test.ts` | An `other` answer carries its text; every blank form is one item error the UI can render, never a schema 400 | Response validation: required, per-type value rules |
| The answer schema accepts `""` and whitespace-only `otherText`; `ResponseRow` rejects an empty `otherText` | `domain/schemas.test.ts` | Blank other text is the validator's 422, and no row ever carries it | Response validation: required, per-type value rules |
| The closed `SUBMISSION_ITEM_CODES` (now including `choice/other-text-required`) and `DRAFT_ITEM_CODES` lists; the new code validates on the `submission/invalid` wire body | `problems.test.ts` | Closed item codes the client can switch on exhaustively | — contract |
| Duplicate `optionIds` rejected as `choice/duplicate-option`, naming the item | `engine/answer-validation.test.ts` | #34: the one `response` invariant not enforced below the application | Duplicate `option_ids` inside one answer |
| Submit: yes and no paths accepted with rows in item order carrying `questionId` / `questionVersion`; missing visible required → `answer/required`; answer to a skipped item → `answer/not-visible` with no value in the result; unknown item key; one failure yields no rows | `engine/answer-validation.test.ts` | Server authority over the reachable path, all-or-nothing, errors never echo answers (§5.5) | Server as authority: an answer to an unreachable item is rejected |
| The server fills `unit` from the pinned question and omits it when the question has none; the row carries the canonical decimal (`72.50` / `72.500` → `72.5`, `72.0` → `72`, `-0` / `-0.0` → `0`, `-12.340` → `-12.34`); single choice is a one-element `optionIds`; every row validates as `ResponseRow` | `engine/answer-validation.test.ts` | #42, #12; the row equals what the column will hold | Response validation: required, per-type value rules |
| Predicate-change fixture at the engine: identical answers accepted under v1 and rejected under a v2 that tightens `itm_03`, naming `itm_03` | `engine/answer-validation.test.ts` | Submit evaluates the *pinned* definition ([[8-testing#6. Test data and fixtures]]) | Path re-evaluation uses the *pinned* definition, not the latest published |
| Calendar date of an instant in UTC, UTC+13, UTC−10 and across a year boundary; `addDays` across month, year and leap day | `engine/calendar.test.ts` | Both clocks resolve a calendar date without reading one | Relative date constraints across a timezone boundary |
| Years 0000–0099, which the date format admits, are not shifted by `Date.UTC`'s legacy 1900 offset: `0099-12-31` + 1 → `0100-01-01`, century and leap edges, a 0000–9999 day-number round trip agreeing with `Date.UTC` where it is correct, a relative-date case in year 99; a date satisfiability case spanning `0099-12-31` / `0100-01-02` | `engine/calendar.test.ts`, `engine/draft-validation.test.ts` | Day arithmetic is correct for every date the schema accepts | Relative date constraints across a timezone boundary |
| East of UTC: at UTC+13 on the 14th, today passes `not_future` in the browser (local, no tolerance) and on the server (UTC + 1 day), strict UTC would reject it, tomorrow is rejected by both. West: the mirror case for `not_past` at UTC−10 | `engine/calendar.test.ts` | #38 and [[5-questionnaire-format#2.4 Relative date constraints resolve against two different clocks]] | Relative date constraints across a timezone boundary |
| The tolerance admits exactly one day either side of UTC today; results are unchanged under three faked system times | `engine/calendar.test.ts` | The evaluator takes `today` as a parameter and never reads a clock | Relative date constraints across a timezone boundary |
| Exact decimal comparison (trailing zeros, `-0`, beyond 2^53), authored constants read as their shortest decimal including exponent forms, integer detection on the canonical form, canonicalization (trailing fractional zeros and point stripped, no negative zero) | `engine/decimal.test.ts` | #42 exactness in comparison and the stored row | Response validation: required, per-type value rules |
| Canonical form is exactly §5.4's: sorted by `itemId`, `optionIds` sorted, the row's (already canonical) decimal string, absent fields omitted, fixed key order | `engine/digest.test.ts` | #37 canonicalization, specified once in `@qp/shared` | Submit idempotency: same digest replays, different digest conflicts |
| Digest is SHA-256 of the canonical form (checked against `node:crypto`), 32 bytes, and identical under key reordering, row reordering and option click order | `engine/digest.test.ts` | A re-serialized retry is not a spurious `409` | Submit idempotency: same digest replays, different digest conflicts |
| A JSON round-trip of the stored columns digests identically; `72.5`, `72.50` and `72.500` digest identically through `validateSubmission` and match the digest recomputed from the stored `72.5` row, `72.51` does not; `-0` and `-0.0` match the stored `0`; null and omitted optional answers and a reordered request body digest identically | `engine/digest.test.ts` | The digest stays a pure function of the persisted rows (#37) | Submit idempotency: same digest replays, different digest conflicts |
| Changing an option, `otherText`, date, text, the number, the unit, or adding / removing an answer changes the digest | `engine/digest.test.ts` | Canonicalization loses no information, so no false `200` | Submit idempotency: same digest replays, different digest conflicts |
| Demo v1 and v2 pass publish validation | `engine/draft-validation.test.ts` | The shipped demo is publishable | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Duplicate `itemId`, a question placed twice, an unresolvable question version, an archived question → their `draft/*` codes | `engine/draft-validation.test.ts` | §5.5, #41; [[7-application-boundary#6.1 Error format — RFC 9457 problem details]] | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Forward reference, self reference, unknown item, type mismatch, unknown option (scalar and list operands) → their `predicate/*` codes; a referential failure suppresses satisfiability verdicts on that item and its dependants | `engine/draft-validation.test.ts` | Forward-only references make cycles unconstructible (§5.1, §5.2); referential integrity (§5.4) | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Exact satisfiability per type: text `answered` with both `value: true` and `value: false` on one item is unsatisfiable, while repeating one value or splitting the two across `any` is satisfiable; single-choice set intersection; multiple-choice required/forbidden overlap, `maxSelections`, `minSelections`, and `includesAnyOf` as a minimum hitting set; number intervals with punctures, integer questions and the question's own bounds; dates as discrete days; relative constraints excluded; `any` groups and empty groups | `engine/draft-validation.test.ts` | Satisfiability checked exactly by domain intersection (§5.3) | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Reachability through the dependency closure: a predicate satisfiable alone but contradicting its references' gates → `draft/unreachable`, three deep, through an `any` with a second way in and one with none, dependants of an unsatisfiable item, and text `answered` with `value: false` inheriting its item's gate | `engine/draft-validation.test.ts` | Reachability is stronger than per-predicate satisfiability (§5.3) | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Problems are listed in item order, then closed-code order, each once | `engine/draft-validation.test.ts` | One deterministic result for publish and `/draft/validate` | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Question save rules: each `question/*` code with its JSON Pointer; the yes/no template and a freeform `other` pass | `engine/question-rules.test.ts` | Cross-field rules a schema cannot express, as closed codes | Question versioning: append-only, items pin a version at add time |

### Wave 1b — Track 2: database

**Backend integration — `apps/backend`, Testcontainers Postgres, roles from `db/init/01-roles.sh`**

| Case | File | Invariant defended | §3 row |
| --- | --- | --- | --- |
| `UPDATE` of a published snapshot is `42501` for `qp_definition`, which has no `UPDATE` on that column, and `QP001` even for `qp_owner` — a direct client bypassing the API | `_tests/db/immutability.test.ts` | Layer 1 and layer 3 of [[5-questionnaire-format#6.4 Three layers of immutability enforcement]] | Questionnaire versioning: publish, immutability, one draft |
| `DELETE` of a published version, and demotion back to draft, are rejected `QP001`; a draft stays editable | `_tests/db/immutability.test.ts` | The `DELETE` trigger [[9-database-schema#4. Immutability in the data layer]] adds to §6.4 | Questionnaire versioning: publish, immutability, one draft |
| `qp_definition` inserting a complete, forged `published` version is rejected `QP001`; a draft carrying a version number is `23514` | `_tests/db/immutability.test.ts` | A published row exists only by promoting a draft in place (#8); the `INSERT` trigger closes the shortcut §11.6 rules out | Questionnaire versioning: publish, immutability, one draft |
| `UPDATE` and `DELETE` on `question_version` and `question_version_option` are rejected `QP001` even where no questionnaire uses the question | `_tests/db/immutability.test.ts` | Question versions are append-only (#13) | Question versioning: append-only, items pin a version at add time |
| Items of a published version reject `INSERT`, `UPDATE`, `DELETE` (from `qp_owner` and from `qp_definition`) and reparenting into a draft; `qp_definition` can update and delete draft items | `_tests/db/immutability.test.ts` | The item guard and its reparent check ([[9-database-schema#4.1 The item guard, and the two ways it fails naively]]) | Questionnaire versioning: publish, immutability, one draft |
| An item insert racing an uncommitted publish blocks, then fails `QP001` when the publish commits, leaving one item row | `_tests/db/immutability.test.ts` | `FOR SHARE` closes the snapshot/item-row drift race | Questionnaire versioning: publish, immutability, one draft |
| A session cannot pin a draft or another questionnaire's version; even as `qp_owner`, a questionnaire cannot point at its own draft, another questionnaire's version, or half a pair | `_tests/db/published-only-guard.test.ts` | A draft is structurally unreferenceable ([[9-database-schema#3.1 The published-only guard]]) | Sessions: start, resume, version pinning |
| A response whose `questionnaire_version_id` is another questionnaire's version or a draft is `23503`; one matching its session's pinned version inserts | `_tests/db/published-only-guard.test.ts` | `response (session_id, questionnaire_version_id)` references `session (id, questionnaire_version_id)`, so a response's provenance cannot disagree with its session (#14, Copilot review 4000925345) | Response meaning preserved across a republish |
| A second draft for one questionnaire is `23505`; a submitted session without a digest is `23514` | `_tests/db/published-only-guard.test.ts` | `questionnaire_one_draft`; `session_state` | Questionnaire versioning: publish, immutability, one draft |
| Every valid answer shape inserts; NULL option arrays, NULL elements, empty text, wrong cardinality, cross-type values, orphan `other_text`, `yes_no` and unknown types are `23514` | `_tests/db/response-shape.test.ts` | `response_shape` with `COALESCE(..., false)` ([[9-database-schema#6.2 `COALESCE(..., false)` is load-bearing]]) | Response validation: required, per-type value rules |
| Duplicate ids inside a `multiple_choice` answer insert cleanly | `_tests/db/response-shape.test.ts` | Pins the stated gap: #34 leaves duplicates to the submit validator | Duplicate `option_ids` inside one answer |
| `qp_execution` cannot read `question`, `question_version`, `question_version_option`, `questionnaire_item` or the base `questionnaire_version`, cannot write or delete from any definition table, and reads questionnaires, `version_question_index` and published versions through `published_questionnaire_version` | `_tests/db/grants.test.ts` | [[7-application-boundary#3.2 Database grants]]; execution cannot read a draft (§2.1, Copilot review 4000925328) | The definition/execution barrier |
| `published_questionnaire_version` returns a published version and never a draft; a session still pins through the composite foreign key without base-table access; `qp_definition` has no privilege on the view | `_tests/db/grants.test.ts` | A `security_barrier` view is the only execution read path to versions | The definition/execution barrier |
| `qp_execution` cannot `UPDATE` or `DELETE` a response or `DELETE` a session; the only `DELETE` either application role holds is `qp_definition` on `questionnaire_item`, and neither holds `TRUNCATE` | `_tests/db/grants.test.ts` | Collected responses are immutable by grant (#24); draft item removal is the one scoped exception, bounded to drafts by the item guard | The definition/execution barrier |
| `qp_definition` cannot read `execution.response`, `execution.session` or a response partition | `_tests/db/grants.test.ts` | Authoring is not a back door into answers (#17) | The definition/execution barrier |
| `qp_definition` gets `permission denied` for `SELECT`, `INSERT`, `UPDATE` and `DELETE` on `audit.event`; `qp_execution` cannot even call `audit.record` | `_tests/db/grants.test.ts` | Audit is reachable only through `audit.record` (#24) | — audit |
| `audit.record` commits with the domain change, is discarded with it on `ROLLBACK`, rejects an unlisted action, and is `SECURITY DEFINER` owned by `audit_owner` with `search_path = audit, pg_temp` | `_tests/db/grants.test.ts` | [[9-database-schema#9.1 A dedicated role, inside the publish transaction]] | — audit |
| `qp_owner` has no `USAGE` on `audit` and cannot call `audit.record` | `_tests/db/grants.test.ts` | The migration identity stays out of the audit schema ([[9-database-schema#9.1 A dedicated role, inside the publish transaction]]) | — audit |
| A definition table created after the grant migration is reachable by `qp_definition` | `_tests/db/grants.test.ts` | `ALTER DEFAULT PRIVILEGES FOR ROLE qp_owner` covers later migrations | The definition/execution barrier |
| `response` has no `DEFAULT` partition and exactly the 36 monthly partitions from 2026-09; an insert outside them fails `23514`; one `created_at` lands in one partition | `_tests/db/partitions.test.ts` | [[9-database-schema#6.4 Partitioning]] | — archival |
| `DETACH PARTITION ... CONCURRENTLY` succeeds today, and fails `55000` once a `DEFAULT` partition is attached | `_tests/db/partitions.test.ts` | Why there is no default partition (#23) | — archival |
| The partition helper names months in UTC, creates only missing partitions, and is idempotent | `_tests/db/partitions.test.ts` | Rollover is a repeatable task, never a default partition | — archival |
| The harness puts a role and password into a connection URL encoded exactly once: `@`, `/`, `:`, `%`, spaces, `#` and non-ASCII decode back to the original | `_tests/db/server.test.ts` | `TEST_DATABASE_URL` and the per-worker URLs authenticate with any password | — harness |
| The roles script creates non-superuser `qp_owner`, `qp_definition`, `qp_execution`, `NOLOGIN` `audit_owner`; `qp_owner` joins `audit_owner` with `INHERIT FALSE`, owns the database and every non-audit table | `_tests/db/roles.test.ts` | Five identities, `qp_owner` is not `POSTGRES_USER` (#39) | The definition/execution barrier |
| After the full migration chain, `execution.response` is `relkind = 'p'` with range strategy on `created_at`, and `item_position_unique` is deferrable and initially immediate | `_tests/db/hand-edits.test.ts` | The two hand edits to the generated `0000_schema.sql` that drizzle-kit's snapshot cannot see | — migrations |
| Swapping two draft items' positions with separate `UPDATE`s succeeds under `SET CONSTRAINTS ... DEFERRED` and fails `23505` without it | `_tests/db/hand-edits.test.ts` | `item_position_unique` has to be `DEFERRABLE` ([[9-database-schema#3.3 Items and the reverse index]]) | Questionnaire versioning: publish, immutability, one draft |
| Every committed `.sql` migration matches its sha256 in `migrations.lock.json`, none is missing, and an unlocked new file fails with the line to add | `_tests/db/migration-lock.test.ts` | Applied migrations are never edited; drizzle never re-runs one | — migrations |
| `drizzle-kit generate` against a temporary copy of `drizzle/` reports no schema changes and writes nothing | `_tests/db/schema-drift.test.ts` | `schema.ts` and the committed migrations describe the same schema (§11.1) | — migrations |
| `replaceDraft` removes, reorders and adds items, renames the draft, bumps `draft_revision` and audits `edit_draft`; it can empty a draft | `_tests/db/definition/questionnaires.test.ts` | `PUT /draft` is whole-document replacement ([[7-application-boundary#4.1 Endpoints]]) | Questionnaire versioning: publish, immutability, one draft |
| `replaceDraft` refuses a stale revision, a questionnaire with no draft, an archived question and a nonexistent question version, and leaves the items untouched | `_tests/db/definition/questionnaires.test.ts` | #43 revision check; #31 archived questions rejected at add time | Question versioning: append-only, items pin a version at add time |
| `qp_definition` promoting a draft with one `UPDATE` of the publish columns, or moving the current-version pointer, is `42501`; its `UPDATE` columns on `questionnaire_version` and `questionnaire` are exactly `title`, `draft_revision`, `updated_at`, `key`, `name`, `closes_at` | `_tests/db/definition/promote-draft.test.ts` | Publishing cannot bypass validation, the reverse index, the pointer or the audit row (Copilot review 4000925311) | Questionnaire versioning: publish, immutability, one draft |
| `definition.promote_draft` promotes, indexes and moves the pointer in one call, and writes no audit row — calling it directly is the accepted, documented way to promote without auditing (Decisions Log #51); rejects a published version `QP001`; rejects a snapshot naming the wrong version, another questionnaire, or items that differ from the draft rows with `22023`, writing nothing | `_tests/db/definition/promote-draft.test.ts` | The only path to a published row keeps the snapshot, item rows, index and audit trail consistent (#24 pattern) | Questionnaire versioning: publish, immutability, one draft |
| `promote_draft` is `SECURITY DEFINER` owned by `qp_owner` with `search_path = definition, pg_temp`; `qp_definition` can execute it and `qp_execution` cannot | `_tests/db/definition/promote-draft.test.ts` | Same hardening as `audit.record` ([[9-database-schema#9.1 A dedicated role, inside the publish transaction]]) | The definition/execution barrier |
| `publishDraft` promotes in place, writes the snapshot, `version_question_index`, the current-version pointer and a `publish` audit row in one transaction | `_tests/db/definition/publish.test.ts` | Publish as the seam ([[7-application-boundary#4.3 Publish and retire]]) | Questionnaire versioning: publish, immutability, one draft |
| `publishDraft` writes exactly one `publish` audit row, as `qp_definition` after `promote_draft`; when that audit write fails, the promotion, pointer and index roll back with it | `_tests/db/definition/publish.test.ts` | The audit record joins the publish transaction ([[6-observability#5.1 Isolation — separate schema with a restricted role]], #52) | — audit |
| A stale draft revision returns an outcome and writes nothing, audit included | `_tests/db/definition/publish.test.ts` | #43 revision check | Questionnaire versioning: publish, immutability, one draft |
| Publishing a draft with a forward reference, an unsatisfiable predicate or an archived question returns `validateDraft`'s items (`predicate/forward-reference`, `predicate/unsatisfiable`, `draft/question-archived`) and leaves the version a draft, the pointer empty, and no index or audit row | `_tests/db/definition/publish.test.ts` | Publish runs the one publish-time validator inside its transaction ([[5-questionnaire-format#5. Publish-time validation]]); a failed publish leaves no audit record | Publish-time rule validation: forward refs, unsatisfiable conditions |
| Two concurrent publishes of one draft: exactly one publishes, the other sees no draft | `_tests/db/definition/publish.test.ts` | The questionnaire row lock plus the compare-and-swap promote ([[9-database-schema#5. Concurrency control]]) | Questionnaire versioning: publish, immutability, one draft |
| The seed builds from `intakeDefinition(1)`, passes publish validation and stores exactly that snapshot under the hardcoded ids, with `qst_which_condition` at question version 3, through the audited authoring path; a second run is a no-op | `_tests/db/seed/demo-questionnaire.test.ts` | #35 hardcoded ids; one demo definition shared by seed and fixtures (§6); [[9-database-schema#11.6 The seed is an integration test wearing a disguise]] | Response meaning preserved across a republish |

## 8. Alternatives considered

### 8.1 Jest for the frontend

The tool already familiar here, and the RTL documentation's default. Rejected because it would mean a second transform pipeline and module-resolution config alongside Vite's, for a test API that is nearly identical to Vitest's. Vitest reuses `vite.config.ts`, so what the tests run through is what the app is built with — and the ESM/TS configuration that makes Jest tedious in a Vite repo simply does not arise.

### 8.2 Mocked repositories, or `pg-mem`, instead of a real Postgres

The fast option, and it would let the integration suite run with no Docker at all. Rejected because the invariants this project is graded on live in the database — the immutability trigger, the one-draft partial index, the append-only audit role, the missing `response` grant. A suite built on a mock passes with every one of those constraints dropped, so it would provide confidence precisely where there is none. `pg-mem` fails the same test one level down: triggers, roles and JSONB operator support are what it approximates.

### 8.3 A shared Postgres from docker-compose instead of Testcontainers

Genuinely attractive: the container already exists, startup cost is zero, and the inner loop is faster. Rejected as the *default* because "run the tests" becomes two commands with an ordering dependency, and CI needs a separately configured service that can drift from the compose definition. Kept as the `TEST_DATABASE_URL` path (§4), which is the same benefit without being the thing a newcomer or a pipeline has to know about.

### 8.4 `supertest`, or a listening server, instead of `inject()`

Rejected as strictly more machinery: a real port, a lifecycle to manage, and flake when ports collide under parallel workers. `inject()` exercises the identical Fastify lifecycle. A listening server is warranted only for what it uniquely tests — keep-alive, streaming, timeouts — none of which is in scope.

### 8.5 Cypress instead of Playwright

The better-known tool with a friendlier interactive runner. Rejected for the CI story this project actually needs: Playwright's parallelism, `webServer`/`--wait` integration, and above all the trace viewer, which makes a failure on a runner debuggable without reproducing it locally. Cypress's in-browser execution model also makes the multi-tab and multi-session interactions in specs 2 and 3 awkward.

### 8.6 A coverage percentage gate

Rejected. The graded behavior is concentrated in a few intricate modules, and a repo-wide threshold is most easily met by testing the surface area that does not matter, while a per-module threshold is the §3 table with worse resolution. Coverage is collected and read; the gate is the §3 table.

### 8.7 Contract tests between definition and execution

Considered because the two halves are deliberately separable ([[7-application-boundary#8. Deployment topology]]). Rejected while they share one process and one shared types package: the compiler already fails the build on a contract break, which is what a Pact-style test would report later and less precisely. Worth revisiting at the point the split becomes two deployables, since that is when the type check stops spanning both sides.

## 9. Open questions

1. **Property-based testing for the rule engine.** `fast-check` over generated questionnaires and answer sets could assert properties the example-based cases cannot — evaluation never revisits an earlier index, the reachable set is stable under reordering of independent items, a predicate over unshown questions never makes an item visible. The engine's combinatorial input space is the ideal target; whether it earns its keep inside an interview timeline is undecided.
2. **Whether end-to-end runs on every PR** or only on the main branch once the suite grows past roughly a minute. Fine as-is at three specs.
3. **Load testing.** The claims in [[3-scaling]] about delivery under concurrency are currently arguments, not measurements. `k6` or `autocannon` against the definition-delivery endpoint would substantiate or embarrass them. Not designed.
4. **Accessibility beyond the committed minimum.** Narrowed rather than deferred: an `@axe-core/playwright` check on the respondent form and the draft editor **is** in scope, alongside the role- and label-based queries in §2.4, on the grounds that the domain argues for it even where the rubric does not ([[10-frontend#7. Accessibility]]). What remains open is everything past that line — a full WCAG 2.2 AA audit, a real screen-reader matrix across NVDA, JAWS and VoiceOver, and reduced-motion and high-contrast handling.
5. **Mutation testing** (Stryker) as the honest check on whether the rule-engine suite is actually good rather than merely green. The right tool for the question and almost certainly out of scope; noted so the question is on the record.
