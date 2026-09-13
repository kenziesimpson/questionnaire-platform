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

**Escape hatch, and it is not only a convenience:** if `TEST_DATABASE_URL` is set, the suite uses it and skips the container entirely. It must be an **owner-level** URL — the suite creates the template database and applies migrations — so it is `DATABASE_URL_OWNER` pointed at a throwaway instance, not either application role. That makes the suite portable to any CI that can supply a Postgres service container but not a Docker socket (§5.3), and locally it points at the compose `db` for a faster inner loop.

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
