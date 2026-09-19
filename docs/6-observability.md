# Observability

> Detail doc for [[2-design-doc#14. Observability]]. The design doc carries the condensed version; this is the reasoning, the concrete field/metric lists, and the decisions behind them.
> Related: [[3-scaling]] (Operations row of the brief's scale table), [[2-design-doc#13. Deployment]].

## 1. What we are optimizing for

The brief asks for "useful logging and enough operational visibility to troubleshoot a failed request **or questionnaire session**." Those are two different questions and they need different signals:

| Question | Who asks it | Signal that answers it |
| --- | --- | --- |
| Why did *this request* fail? | On-call, during an incident | Trace + correlated logs, request-scoped |
| Why did *this respondent* get stuck / give up at Q7? | Product, support, or us debugging a branching bug | Session-scoped domain events + navigation history |
| Is the service healthy right now? | Alerting | RED metrics + saturation, aggregated |
| Who changed this published questionnaire, and when? | Compliance / audit | Audit trail (durable, not log retention) |
| Is the data still internally consistent? | Nobody, until it's too late | Invariant checks (§9) |

A standard APM install answers the first and third well and the others not at all. The sections below are mostly about closing that gap.

**Baseline, already decided:** OpenTelemetry is the single instrumentation standard for traces, metrics and logs; the backend uses `@fastify/otel` (one of the reasons Fastify was chosen); the browser propagates W3C trace context so frontend and backend share a trace id. OTel is deliberately the *portable seam* — exporters point at a Collector, so the backing vendor can change without touching application code.

## 2. Signal taxonomy

### 2.1 Traces

Auto-instrumented via `@fastify/otel` (incoming HTTP) plus `@opentelemetry/instrumentation-pg` (dependency calls). Manual spans for the parts that carry the domain meaning:

- `questionnaire.publish` — the publish transaction, the single most consequential write in the system.
- `rule.evaluate` — server-side navigation decision (submit-time validation; the client does the interactive one, see §6).
- `session.submit` — final submission, including validation and persistence.

**Standard attributes on every span on the execution path** (this is what makes a stuck session traceable):

| Attribute | Example | Notes |
| --- | --- | --- |
| `questionnaire.session_id` | uuid | Present from session creation onward |
| `questionnaire.id` | uuid | |
| `questionnaire.version` | int | Which immutable version the session is pinned to |
| `questionnaire.question_id` | uuid | The question being served/answered |
| `questionnaire.question_type` | `single_choice` | Type only — never the value |
| `questionnaire.outcome` | `accepted` / `rejected_validation` | |

### 2.2 Metrics

RED per endpoint comes free from the HTTP instrumentation (`http.server.request.duration` histogram carries rate, errors and duration). What we add:

**Domain metrics** (`questionnaire.*` namespace):

- `questionnaire.sessions.started` (counter)
- `questionnaire.sessions.completed` (counter)
- `questionnaire.sessions.resumed` (counter)
- `questionnaire.answers.rejected` (counter, by `reason`)
- `questionnaire.publish.total` (counter, by outcome)
- `questionnaire.session.duration` (histogram)

**Saturation metrics** — the real early-warning signals under load, none of which any framework emits by default:

- Event loop lag, heap usage, GC pause — via `@opentelemetry/instrumentation-runtime-node`. Event loop lag is the single best "Node is in trouble" signal and it moves before latency does.
- `pg` pool state: `totalCount`, `idleCount`, `waitingCount` exposed as gauges. `waitingCount > 0` sustained means the pool, not the database, is the bottleneck — an important distinction because the fixes differ (pool size vs. query tuning vs. replicas).

### 2.3 Logs

Structured JSON via pino, one line per event, no string interpolation of domain data. Levels:

| Level   | Used for                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ |
| `error` | Unexpected failure; something is broken and someone may need to act                              |
| `warn`  | Expected-but-notable: validation rejection rate spike, session resumed against a retired version |
| `info`  | Domain events (§4), lifecycle (startup, migration applied, shutdown)                             |
| `debug` | Rule evaluation decisions; off in production, on per-request via a header in dev                 |

Every log line carries `trace_id` and `span_id` (pino + OTel log correlation) plus the same standard attributes as §2.1, so a trace and its logs are one query apart.

### 2.4 Domain events

See §4. These are `info` logs *and* counters, emitted through one call so the two can never drift.

## 3. Respondent answers must never enter telemetry

**This is the most important rule in this document.** The demo questionnaire asks about medical conditions; answer values are exactly the data that must not leak into a log aggregator, a trace backend, or a metric label. HIPAA compliance is listed as future work in the brief, but the telemetry discipline that makes it *possible* has to be designed in now — retrofitting redaction across a codebase is significantly harder than starting with it.

**The rule:** question identifiers, types, and validation outcomes are telemetry. Answer values are not. Ever. Not at `debug`, not in an exception message, not in a metric label.

### 3.1 Enforcement ladder

Ordered by how much they actually protect us, which is not the same as ordered by effort.

**Layer 0 — make it structurally impossible.** The strongest control is a type, not a checker. Answer values are wrapped in a branded `Sensitive<T>` whose serializers all return `[redacted]`:

```ts
export class Sensitive<T> {
  constructor(private readonly value: T) {}
  unwrap(): T { return this.value }          // the only way out
  toString() { return '[redacted]' }
  toJSON() { return '[redacted]' }
  [Symbol.for('nodejs.util.inspect.custom')]() { return '[redacted]' }
}
```

Anything that accidentally serializes one — `JSON.stringify` in a log call, template interpolation, `String()`, `console.log`, `util.inspect`, an error message, an OTel attribute — gets the redaction instead of the value. This inverts the problem: static analysis no longer has to recognise "any expression that might be an answer," it only has to find `.unwrap()` outside the persistence and validation layers, which is a small and enumerable surface.

**Layer 0 also reaches the log message itself.** `log()`'s message parameter is typed so that only a string *literal* satisfies it: `string` and an interpolated template both widen to a type a literal cannot be distinguished from, so both are rejected by the same type-level check that makes an accidental `` `rejected ${reason}` `` a compile error rather than a review comment. Domain data has exactly one way in, the closed `context` object. A message is the one telemetry string no runtime check can vet, since a legitimate message and an answer look alike, so a cast that defeats the type (`value as "message"`, `as never`) is also an ESLint error, from a syntactic rule that misses a hoisted cast, a type alias, a wrapper or an aliased logger; the same rule covers the logger's module name and a span name, both of which are additionally checked against closed lists at runtime.

**Layer 1 — a single telemetry boundary.** One module (`packages/telemetry`) is the only place in the codebase permitted to import `pino` or `@opentelemetry/api`. It exposes functions taking a **typed context object with a closed field set** — no `...rest`, no `Record<string, unknown>`, no `any`. Enforced by an ESLint `no-restricted-imports` rule with a path exception for that module: roughly three lines of config, and very hard to violate by accident.

Belt and braces at the exit: a `SpanExporter` decorator that copies each span with non-allowlisted attributes stripped before delegating to OTLP, and a pino formatter doing the same for log objects. This catches what the type system can't — a third-party instrumentation package deciding to attach a request or response body, for instance.

**Layer 2 — a test that asserts the property.** The layer most often skipped and the most convincing one to show a reviewer. The test harness installs an in-memory span exporter and an in-memory pino destination, runs the full branching flow with a sentinel answer value (`LEAK_DIABETES_8F3A`), and asserts that string appears in **zero** spans, **zero** log records and **zero** metric attributes.

One test, and it covers every code path the integration suite already exercises — including paths added later, which is the property grep-based checks lack.

**Layer 3 — pre-commit and CI.** A `lefthook` pre-commit hook runs lint + typecheck on staged files for fast local feedback. *Stated honestly in the doc:* pre-commit hooks are advisory, because `--no-verify` exists. The same checks run in CI, and **CI is the gate**; the hook is a convenience, not a control.

**Layer 4 — agent review on the PR, advisory.** A GitHub Action posts a review comment answering one focused question: *does this diff introduce any path by which a respondent answer value could reach a log, span attribute, metric label, or error message?* Non-deterministic, so it comments rather than blocks — the deterministic layers gate the merge, and the agent covers shapes the rules don't anticipate. (The brief explicitly encourages AI tooling; this is a legitimate use of it rather than a decorative one.)

**Layer 5 — a project skill.** `.claude/skills/telemetry-safety/` encodes the rule where coding agents will read it, alongside the existing `questionnaire-assignment` skill. Since agents are writing most of this code, preventing the violation is cheaper than catching it. Lowest effort item here and arguably the highest leverage.

### 3.2 Prototype scope

| Layer | In prototype? |
| --- | --- |
| 0 — `Sensitive<T>` wrapper | Yes |
| 1 — telemetry boundary module + lint rule + exporter scrub | Yes |
| 2 — sentinel leak test | Yes — see [[2-design-doc#15. Testing]] |
| 3 — pre-commit + CI | Yes (cheap) |
| 4 — agent PR review | Documented; implement if time allows |
| 5 — `telemetry-safety` skill | Yes (cheap, and it protects the rest of the build) |

## 4. Domain events

Request telemetry tells us the API returned 200. It does not tell us that 40% of respondents abandon at the medical-condition branch. Domain events are a first-class stream, emitted through one helper so the log line and the counter can't drift apart:

| Event | Emitted when | Key attributes |
| --- | --- | --- |
| `questionnaire.created` | Draft created | questionnaire id |
| `questionnaire.published` | Version published | questionnaire id, version |
| `questionnaire.retired` | Version retired | questionnaire id, version |
| `session.started` | Respondent begins | session id, questionnaire id, version |
| `session.resumed` | Incomplete session reopened | + elapsed since last activity |
| `session.question_answered` | Answer accepted | + question id, question type |
| `session.answer_rejected` | Validation failure | + question id, reason (never the value) |
| `session.item_skipped` | A visibility predicate evaluated false and hid an item | + item id, question id |
| `session.abandoned` | Inactivity threshold passed, or tab closed | + last question id |
| `session.completed` | Submitted | + duration, question count |

`session.abandoned` and `session.item_skipped` are the two that make the drop-off question answerable — the reason the design keeps a server-side session record at all ([[2-design-doc#8. Sessions & Responses]]). `session.item_skipped` carries no separate predicate id: predicates have no identity of their own, so the item they hid is what names which predicate fired ([[2-design-doc#17. Decisions Log]] #41).

## 5. Audit trail

**An audit trail is not an application log.** Different consumers, different retention, different integrity requirements. "Who published version 3, and when" must survive log rotation, log-pipeline outages, and a decision to cut logging costs. It belongs in the database.

Contents: actor, action (`publish` / `retire` / `edit_draft`), target (questionnaire id, version), timestamp, and a before/after summary for edits. Append-only — no `UPDATE`, no `DELETE`.

### 5.1 Isolation — separate schema with a restricted role

**Decision:** an `audit` schema in the same Postgres instance, owned by a dedicated `NOLOGIN` role and reachable only through a `SECURITY DEFINER` function. Append-only becomes a **database guarantee** rather than a convention the application is trusted to follow, and the audit write joins the transaction that performs the domain change.

The mechanism landed stronger than this section originally described. Narrowing grants on the application role to `INSERT` and `SELECT` was the first form, and it works; it was superseded by one that costs the same and gives more (Decisions Log #24, [[9-database-schema#9.1 A dedicated role, inside the publish transaction]]). `audit_owner` owns the table and the function, has no login, and `qp_definition` holds **zero** privilege on `audit.event` — not `INSERT`, not even `SELECT`. Append-only stops being "a role that was only granted `INSERT`" and becomes "a table no application role can reach at all, behind one function that only appends".

That second property is the reason this beats a separate database today. Publishing already runs as a single transaction ([[2-design-doc#12.1 Authoring is normalized; published is a snapshot]]); a separate database would put the audit write outside it:

> Publishing version 3 and recording "user X published version 3" become two operations that can fail independently — so a publish can succeed with no audit record, which is precisely the failure an audit log exists to prevent.

The isolation that actually matters here — a separate access path, separate grants, immutability the application cannot override, and a retention policy decided independently of application data — a schema plus a restricted role already provides. A separate database adds physical separation and costs atomicity to get it.

**The deferred option: separate database + transactional outbox.** When the audit trail needs to be operated, backed up or access-controlled genuinely independently — or extracted into its own service — the move is: the domain transaction writes to an `audit_outbox` table in its own database, and a relay ships rows to the audit store and marks them shipped. Atomic at the point of truth, eventually consistent at the destination. That outbox *is* the seam the standalone service is extracted along — the relay becomes a publisher, the audit service becomes a consumer.

**Two things to get right now so that move stays cheap**, both free today:

- Audit writes go through a single repository function rather than being scattered inline at each call site, so the writer can be swapped for the outbox behind one interface.
- Audit rows carry their own identifier and timestamp rather than borrowing the domain row's, so they remain meaningful once they live somewhere else.

## 6. Client-side telemetry

The SPA receives the whole questionnaire and evaluates branching rules in the browser, keeping partial answers client-side. **A consequence worth stating plainly: the server never observes most navigation decisions.** Server traces are structurally blind to the respondent's actual path through the questionnaire. Without client telemetry, "which branch did they take before they gave up" is unanswerable.

**Decision: instrument the client.** Traces and logs from the browser, correlated with the backend.

- `@opentelemetry/sdk-trace-web`, propagating `traceparent` on API calls. Each app adds the header by hand in its one `fetch` wrapper, with `injectTraceHeaders` from `@qp/telemetry/browser`, rather than through `@opentelemetry/instrumentation-fetch` patching the global `fetch` (O12). Because the nginx proxy keeps the app single-origin ([[2-design-doc#13. Deployment]]), this needs no CORS header allowances — a small dividend of that deployment choice.
- Domain events from §4 that occur client-side (`session.item_skipped`, `session.abandoned`) are emitted from the browser.
- **Events batch to a backend `/telemetry` endpoint rather than shipping directly to a Collector.** Three reasons: no publicly exposed unauthenticated collector; the server can stamp trusted server-side context onto client-reported events; and the client path runs through the *same* allowlist filter from §3, so a careless client event cannot leak an answer either: the browser queue applies it before anything is queued (`@qp/telemetry/browser`), and the endpoint applies it again. The endpoint is rate-limited, and the closed schema decides which fields are kept, not whether the batch is (O17).
- **`navigator.sendBeacon` on `visibilitychange`/`pagehide`** to flush pending events when the tab closes. Without it the abandonment event — the one we most want — is the one most likely to be lost, since abandonment and tab-closing are the same user action.

Cost: client telemetry is unauthenticated and therefore spoofable. Acceptable while it feeds product understanding rather than billing or access decisions; noted so it isn't mistaken for trustworthy input.

## 7. Cardinality and metric hygiene

**Session ids, questionnaire ids and question ids must not appear as metric labels.** Each unique label combination is a separate time series; a per-session label turns one metric into unbounded cardinality and takes the metrics backend down. This is the most common way a well-intentioned observability change causes an outage.

The rule: **high-cardinality identifiers live in traces and logs; metrics carry only bounded dimensions** (endpoint, status class, question type, rule outcome). To get from an anomalous metric to the specific session, use exemplars where supported, otherwise pivot by time window plus the bounded attributes and read the traces. (Exemplar support in the OTel JS SDK is still maturing — worth verifying rather than assuming, with the time-window pivot as the fallback.)

## 8. SLOs and alerting

**Deferred — decision to be made later.** Direction, for when we do:

- Candidate SLIs: availability and p95 latency of questionnaire delivery; submission success rate; publish success rate.
- Alert on **symptoms and error-budget burn**, not causes. Nobody should be paged for CPU; they should be paged because respondents can't submit.
- Distinguish paging alerts (user-visible, needs action now) from ticketing alerts (degradation, handle in hours).
- Health endpoints are separate from metrics and needed regardless: `/health/live` (process up) and `/health/ready` (`SELECT 1` on the definition, execution and reporting pools; the migrate Job, not the probe, gates migrations) feed the Kubernetes probes stubbed in [[2-design-doc#13. Deployment]] §13.2.
- Backups are listed under Operations in the brief: backup success/age needs to be a monitored metric, and a restore drill is the only evidence a backup works. Deferred with SLOs.

## 9. Correctness and invariant monitoring

**Deferred deliberately — circle back.** Recorded here so the reasoning isn't lost.

A class of failure produces **HTTP 200 with a plausible-looking body**. No exception fires, no status code is wrong, and nothing in §2 moves. The structural design already removes the worst of it — cycles and deadlock are unrepresentable, and three checks run inside the publish transaction ([[5-questionnaire-format#5. Publish-time validation]]). What remains is **runtime drift**, which publish-time validation cannot see:

| Candidate gauge | What it catches |
| --- | --- |
| `invariant.orphaned_answers` | A stored answer whose `questionId` / `optionId` is absent from the snapshot it pins to. Should be impossible — worth proving rather than assuming, since it is silent when it isn't. |
| `invariant.never_shown_items` | Items no respondent has seen in a live version: the authoring mistake that publish-time check #2 only partially catches, because general satisfiability isn't attempted there. |
| `invariant.snapshot_format_versions` | Which `formatVersion`s are actually live, by count. Turns the support-window question ([[2-design-doc#18. Open Questions]] §4) from a judgement call into a measurement. |

One metric is worth adding **now** rather than deferring, because it measures the cost of a decision already taken:

- `questionnaire.sessions.rejected_past_cutoff` — sessions started before `closes_at` and submitted after it, i.e. respondents who lost completed work to the hard cutoff ([[2-design-doc#8.1 Questionnaire lifecycle and retirement]]). That count is the whole argument for or against making `cutoffMode` configurable, and right now that open question would be settled on intuition instead.

Two things were separated during this discussion and are worth keeping separate:

- **Status-code discipline** — validate at the edge with TypeBox so malformed input cannot reach a handler, and surface failures as 4xx — is a good API principle and belongs in [[2-design-doc#9. API / Service Boundary]]. It does not detect anything in the table above, because those requests are well-formed and succeed.
- **Eliminating 5xx is not the goal.** When Postgres is down a 5xx is the correct answer; converting infrastructure failure into a 4xx hides it from the error budget and misattributes the fault to the client.

## 10. Sampling, retention, cost

- Parent-based sampler with a ratio for successful reads; **always sample errors and slow requests**. Head sampling is sufficient at prototype scale; tail sampling (sample the whole trace *after* seeing it failed) requires the Collector's tail-sampling processor and is the natural next step.
- Logs are the expensive signal. Domain events at `info` are low-volume by construction; rule-evaluation detail stays at `debug` and off in production.
- Response *data* retention is a separate question from telemetry retention and is governed by the domain, not by operations.

## 11. Local and hosted setup

The prototype must stay one command ([[2-design-doc#13. Deployment]]), so the observability stack does not become four more containers a reviewer has to run.

- The SDK is always wired with OTLP exporters, controlled by `OTEL_EXPORTER_OTLP_ENDPOINT`. Unset, the app runs with instrumentation active and export disabled — zero friction for `docker compose up`.
- A **Compose profile** (`docker compose --profile observability up`) adds an OTel Collector and a trace/metrics UI for anyone who wants to see it. Opt-in, committed, documented in the README.
- Hosted: the Collector is the only thing that knows the vendor. Application code never does.

## 12. Change correlation and synthetics

**Noted as production practice; out of scope for the prototype.**

- Deploy and migration markers annotated onto dashboards — most incidents are change-caused, and "what changed at 14:02" is the first question in every one of them.
- A synthetic leak test completing the medical-condition demo questionnaire end to end every few minutes: the only signal that proves the *workflow* works rather than that the processes are up. Cheap to build here because the demo questionnaire already exists, which is why it's worth mentioning even while deferring it.

## 13. Decisions and open questions

### Decided

| # | Decision |
| --- | --- |
| O1 | OpenTelemetry as the single instrumentation standard; Collector as the vendor seam; `@fastify/otel` on the backend |
| O2 | Respondent answer values never enter telemetry, enforced by the ladder in §3 — `Sensitive<T>` type, single telemetry boundary + lint rule, exporter scrub, sentinel leak test, CI gate, advisory agent review, `telemetry-safety` skill |
| O3 | Domain events (§4) as a first-class stream, emitted as paired log + counter |
| O4 | Audit trail lives in the database, append-only, in an `audit` schema owned by a `NOLOGIN` role and reachable only through a `SECURITY DEFINER` function, so immutability is enforced by Postgres and the write shares the publish transaction; separate database + outbox, and eventually a standalone audit service, are the documented future extraction |
| O5 | Client-side traces and logs, batched to a backend `/telemetry` endpoint, flushed with `sendBeacon` |
| O6 | High-cardinality ids in traces/logs only, never in metric labels; Node saturation metrics (event loop lag, GC, pool waits) included from the start |
| O7 | Observability stack is an opt-in Compose profile so the one-command demo stays one command |
| O8 | One logger per module (`logger("definition")`) with one method per level: `debug`, `info`, `warn`, `error`, and no `fatal`. Log context is a closed registry of fields whose types cannot carry free text (ids, closed enums, numbers, booleans); it replaces the respondent-only `TelemetryContext`, and adding a field is a one-line reviewed change. A problem outcome logs through the same fields: slug, status, item codes and item ids, never `title`, `detail`, `instance` or the body. Both apps send `info`, `warn` and `error` to `/telemetry`; `debug` stays in the browser console in development builds. 2026-09-18 |
| O9 | No telemetry store of our own, and no telemetry in the application's Postgres, which holds the answers telemetry must never contain. The Collector's exporter list is where a store is added. [gh#118](https://github.com/kenziesimpson/questionnaire-platform/issues/118) tracks an analytics store for domain events. 2026-09-18 |
| O10 | Six alerts ship with the telemetry work, pulled forward from §8: submit success rate drops; 5xx rate rises; p95 latency of the questionnaire definition fetch rises; event-loop lag stays high; requests stay queued for a pool connection; fewer than one month of future `response` partitions remain, since a missing partition fails every submit. SLOs and error budgets stay deferred. 2026-09-18 |
| O11 | The server emits `session.item_skipped` and `session.question_answered` for submitted sessions, from the path it already evaluates at submit. The browser emits only what the server cannot see, chiefly `session.abandoned`. Both carry the session id, so a session's client and server events join on it. Amends §4 and §6. 2026-09-18 |
| O12 | Each app adds `traceparent` by hand in its one `fetch` wrapper, rather than through `@opentelemetry/instrumentation-fetch` patching the global `fetch`. Amends §6. 2026-09-18 |
| O13 | Session ids stay in traces and logs as named fields. Spans drop `url.path` and `url.full` and keep `http.route`, and nginx's access log masks session ids in paths, because a session id is a bearer credential ([[7-application-boundary#7. Access model and data barriers]]). 2026-09-18 |
| O14 | Reading a response's raw answers writes an audit row now, not only a log event: a new `view_response` action, recorded through `audit.record` in the same transaction as the read, so a failed audit write fails the read. The actor is the placeholder author until authentication lands. Amends [[2-design-doc#17. Decisions Log]] #89, since `qp_reporting` gains `EXECUTE` on `audit.record` beside its `SELECT` grants. How the session id is stored on the row (in `summary` or a new column) is left to the implementing PR. 2026-09-18 |
| O15 | The `observability` Compose profile adds two containers: an OTel Collector and `grafana/otel-lgtm` as the local trace, log and metric store with its UI. 2026-09-18 |
| O16 | `pg_stat_statements` is enabled in the `db` service by default, not only in the profile, since it needs `shared_preload_libraries` and so a restart to turn on later. 2026-09-18 |
| O17 | Unknown telemetry fields are dropped, not rejected. The `/telemetry` endpoint keeps each event, strips any field outside the registry (O8) and counts it in `telemetry.ingest.dropped{reason}`; the Collector's redaction processor does the same. Fields change expand-then-contract: a new field is allowed in the Collector before any build sends it, and removed from the Collector only after no deployed build sends it. A browser tab left open across a deploy then loses one field rather than all its telemetry. Amends §6's "validates against the same closed schema": the closed schema decides what is kept, not whether the batch is. 2026-09-18 |
| O18 | The admin responses browser ([gh#18](https://github.com/kenziesimpson/questionnaire-platform/issues/18), landed in #115) is the one surface that returns raw answers, so O14 applies to it precisely. `GET /api/reporting/questionnaires/:id/responses/:sessionId` (`getSessionDetail`) writes the `view_response` audit row. `GET /api/reporting/questionnaires/:id/responses` (`listSessions`) returns `SessionSummary` rows, which carry only counts, status and timestamps, and writes none; it is a metric and a log line like any other route. `qp_reporting` already exists with `SELECT` only (migrations `0016`, `0017`), so O14's change is a new migration after them that adds the `view_response` action and the `EXECUTE` grant on `audit.record`. The module's "cannot write" property in [[9-database-schema]] becomes "cannot write except through `audit.record`". 2026-09-18 |
| O19 | The list endpoint's pagination `cursor` is `base64url(direction\|startedAt\|sessionId)`, so it carries a session id in the query string and O13 covers it: spans keep `http.route` only, and nginx's access log masks the `cursor` parameter as well as ids in paths. Telemetry from the admin browser names a screen by its route template (`/questionnaires/$questionnaireId/responses/$sessionId`), never by the URL, and the admin's `/telemetry` events carry no answer text, cursor or query string. The response-detail screen renders answers, so the admin error boundary and any React Query devtools or cache dump stay out of telemetry: a component error reports its type and stack frames only (O8). 2026-09-18 |
| O20 | The sentinel leak test (M7) plants its value in a real stored response and reads it back through `getSessionDetail` and `listSessions`, then asserts it is absent from every exporter, the pino output and the `/telemetry` ingest, in addition to the submit path. The admin's response-detail screen gets a component test that renders a planted answer and asserts nothing reaches the telemetry wrapper. `listSessions` is added to the `pg_stat_statements` and slow-query review: it is the one paged read over `execution.session`, backed by `session_by_questionnaire`, and a regression there shows first as latency on that route. No new alert; the O10 six stand. 2026-09-18 |

### Considered and left out

| # | Considered | Why left out | Tracked |
| --- | --- | --- | --- |
| L1 | Build tagging: commit, version and environment as resource attributes on every signal, the client's build recorded beside the server's to measure version skew, source maps per SHA, deploy markers | Nothing in the prototype runs two versions at once. Adding it later touches config, the telemetry resource, the Vite configs and the Dockerfiles, not call sites | [gh#117](https://github.com/kenziesimpson/questionnaire-platform/issues/117) |
| L2 | Recording downstream calls and preparing for the service split: `instrumentation-undici` for outbound `fetch`, a `dependency(name).call()` wrapper giving a client span and a `dependency.duration{dependency, outcome}` histogram, trace-context helpers for queue messages and the audit outbox, and a module tag on spans and metrics | The backend calls nothing but Postgres today. O8's per-module logger already tags logs, and OTel carries trace context across a process boundary without any of this | — |
| L3 | Closing `schema/${string}` to a fixed list of codes in the shared problem contract, so the code is safe as a metric label | Backward compatibility: `problemFromWire` rejects a problem whole, so an old admin tab would reject every body carrying a code it predates. Coupling: every service would share one list. Instead, the telemetry projection maps any code outside its known list to `schema/other`, leaving the wire contract open | — |
| L4 | Strict ingest: rejecting a whole telemetry batch that carries a field outside the registry | A respondent's tab can stay open across a deploy that removes a field, and from then on every batch it sends would be rejected, `session.abandoned` included — the event we most want. Dropping the field (O17) keeps the same guarantee, since nothing unknown is kept either way | — |

### Open

- SLOs, error budgets, backup monitoring — deferred (§8). The six alerts in O10 are the exception.
- Invariant monitoring design — deferred (§9). One exception worth pulling forward: `questionnaire.sessions.rejected_past_cutoff`, which measures the cost of the hard-cutoff decision.
