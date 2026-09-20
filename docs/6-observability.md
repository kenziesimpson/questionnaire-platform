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

> §2 to §6 are the design as first written. Track 8's V1 reconciles them against what shipped; until then, [[4-implementation-plan#Wave 3b — observability and pipeline]] says what exists.

### 2.1 Traces

Auto-instrumented via `@fastify/otel` (incoming HTTP) plus `@opentelemetry/instrumentation-pg` (dependency calls). Manual spans for the parts that carry the domain meaning:

- `questionnaire.publish` — the publish transaction, the single most consequential write in the system.
- `questionnaire.create`, `questionnaire.edit_draft`, `questionnaire.open_draft` and `questionnaire.retire` — the other questionnaire lifecycle writes, one span each; `retire` covers setting, moving and clearing the close time. Each carries the questionnaire id, and the trace id of the active span goes on the audit row the write records.
- `rule.evaluate` — server-side navigation decision (submit-time validation; the client does the interactive one, see §6).
- `session.submit` — final submission, including validation and persistence.
- `browser.request` — the browser's span around one API call, in each app's `fetch` wrapper. It is never exported: it exists so the request carries a `traceparent` and so the browser's log lines take its trace and span ids (§6). It records only when the app's build enables tracing.

**Standard attributes on every span on the execution path** (this is what makes a stuck session traceable):

| Attribute | Example | Notes |
| --- | --- | --- |
| `questionnaire.session_id` | uuid | Present from session creation onward |
| `questionnaire.id` | uuid | |
| `questionnaire.version` | int | Which immutable version the session is pinned to |
| `questionnaire.question_id` | uuid | The question being served/answered |
| `questionnaire.question_type` | `single_choice` | Type only — never the value |
| `questionnaire.outcome` | `accepted`, `replayed`, `rejected_validation`, `rejected_conflict`, `failed` | Set on `session.submit` once the outcome is known; a replay is `replayed`, so `accepted` counts first submissions only |

### 2.2 Metrics

RED per endpoint comes free from the HTTP instrumentation (`http.server.request.duration` histogram carries rate, errors and duration). What we add:

**Domain metrics** (`questionnaire.*` namespace):

- `questionnaire.sessions.started` (counter)
- `questionnaire.sessions.completed` (counter)
- `questionnaire.sessions.resumed` (counter)
- `questionnaire.answers.rejected` (counter, by `reason`; exact: it adds the number of rejections per reason, however many the submit had)
- `questionnaire.answers.accepted` (counter, by `questionType`)
- `questionnaire.items.skipped` (counter)
- `questionnaire.submissions` (counter, by `outcome`: `accepted`, `replayed`, `rejected_validation`, `rejected_conflict`, `failed`)
- `questionnaire.sessions.rejected_past_cutoff` (counter; see §9)
- `questionnaire.publish.total` (counter, by outcome: `accepted`, `rejected_validation`, `rejected_conflict`, `failed`)
- `questionnaire.publish.rejections` (counter, by draft item code; exact: it adds the number of refused items per code, however many the publish named)
- `questionnaire.draft.conflicts` (counter: a draft save or publish refused because the draft had changed)
- `questionnaire.session.duration` (histogram in milliseconds, with explicit buckets from one second to a day)
- `browser.page.load.duration` (histogram in milliseconds, no labels, with explicit buckets from 100 ms to a minute): what a browser reports about its own page load, recorded by the ingest from `page.loaded` (§6). Client-reported and spoofable, so it is a product measure and never an alert on its own

**Saturation metrics** — the real early-warning signals under load, none of which any framework emits by default:

- Event loop lag, via `@opentelemetry/instrumentation-runtime-node` (D1): the gauges `nodejs.eventloop.delay.min`, `.max`, `.mean`, `.stddev`, `.p50`, `.p90` and `.p99`, in seconds with no label, and `nodejs.eventloop.utilization`. Event loop lag is the single best "Node is in trouble" signal and it moves before latency does. The delay gauges report nothing until the loop has been sampled five times. Heap usage and GC pause are not exported: the instrumentation labels them by heap space and GC kind, which are not on the attribute allowlist, so the exporter drops those metrics whole (`instrument-allowlist.ts`). Exporting them means allowlisting closed label sets first.
- `pg` pool state (D1): the gauges `db.pool.connections.total`, `db.pool.connections.idle` and `db.pool.connections.waiting`, one point per pool, labelled `db.pool` (`definition`, `execution`, `reporting`). They are observable gauges that read each pool's `totalCount`, `idleCount` and `waitingCount` when metrics are collected, registered by `watchPool` from `openDatabase`. `waiting > 0` sustained means the pool, not the database, is the bottleneck — an important distinction because the fixes differ (pool size vs. query tuning vs. replicas). The `pg` instrumentation's own pool metrics are dropped: they are labelled by host, port and database, which are the same for all three pools.
- `db.client.operation.duration` (D1), the `pg` instrumentation's histogram of statement durations in seconds, labelled `db.operation.name` (the statement's first whitespace-delimited word if it is on the exporter's closed list of SQL verbs, else `OTHER`), `db.namespace`, `server.address` and `server.port`.

### 2.3 Logs

Structured JSON via pino, one line per event, no string interpolation of domain data. Levels:

| Level   | Used for                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ |
| `error` | Unexpected failure; something is broken and someone may need to act                              |
| `warn`  | Expected-but-notable: validation rejection rate spike, session resumed against a retired version |
| `info`  | Domain events (§4), lifecycle (startup, migration applied, shutdown)                             |
| `debug` | Rule evaluation decisions; off in production, on per-request via a header in dev                 |

Every log line carries `trace_id` and `span_id` (pino + OTel log correlation) plus the same standard attributes as §2.1, so a trace and its logs are one query apart. When export is on, each line is also emitted as an OpenTelemetry log record from the same sink (§11).

### 2.4 Domain events

See §4. These are `info` logs, and counters where an event has one, emitted through one call so the two can never drift; an event may be log-only (a capped per-item line, §4).

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

Belt and braces at the exit: a `SpanExporter` decorator that copies each span with non-allowlisted attributes stripped before delegating to OTLP, and a pino formatter doing the same for log objects. This catches what the type system can't — a third-party instrumentation package deciding to attach a request or response body, for instance. The scrub fails closed too: when it or a sink cannot process a signal it emits nothing partial and counts the failure as `internal` in `telemetry.scrub.dropped`, and never throws into the code that logged, so telemetry cannot fail a request or a commit.

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

Request telemetry tells us the API returned 200. It does not tell us that 40% of respondents abandon at the medical-condition branch. Domain events are a first-class stream, emitted through one helper so the log line and its counter, when it has one, can't drift apart:

| Event | Emitted when | Key attributes |
| --- | --- | --- |
| `questionnaire.created` | A questionnaire created, with its first draft; opening the next draft of an existing questionnaire (`open_draft`) creates a draft too and emits nothing | questionnaire id |
| `questionnaire.published` | Version published; emitted after the publish transaction commits, so a rolled-back publish emits nothing | questionnaire id, version |
| `questionnaire.retired` | A close time set or moved: every `PUT` of a non-null `closesAt` (`retire` in the audit trail), including one that only changes the date; clearing it is `reopen` and emits nothing | questionnaire id |
| `questionnaire.publish_finished` | A publish decided: accepted, rejected for validation, rejected as stale, or failed | questionnaire id, outcome; for a validation refusal also `findingCount` (every item the refusal names) and `omittedCount` (how many were not logged one by one; 0 up to `MAX_FINDINGS`) |
| `questionnaire.publish_rejected` | One per item a refused publish names, at most `MAX_FINDINGS` per publish; a log line only, it moves no counter | questionnaire id, item id, draft item code |
| `questionnaire.publish_items_rejected` | One per distinct draft item code a refused publish names, whatever the number of items; drives `questionnaire.publish.rejections` | questionnaire id, draft item code, `codeFindingCount` (items with that code) |
| `questionnaire.draft_conflict` | A draft save or publish refused because the draft had changed | questionnaire id |
| `session.started` | Respondent begins | session id, questionnaire id, version |
| `session.resumed` | Incomplete session reopened | + elapsed since the session started (the server keeps no last-activity time) |
| `session.question_answered` | Answer accepted | + question id, question type |
| `session.answer_rejected` | Validation failure; one per rejection, at most `MAX_FINDINGS` per submit; a log line only, it moves no counter; item and question id are absent for an unknown item key, which the respondent chose | + question id, reason (never the value) |
| `session.answers_rejected` | One per distinct rejection reason in a refused submit, whatever the number of rejections; drives `questionnaire.answers.rejected` | session id, reason, `codeFindingCount` (rejections with that reason) |
| `session.item_skipped` | A visibility predicate evaluated false and hid an item | + item id, question id |
| `session.rejected_past_cutoff` | A submit refused because the questionnaire had closed | session id, questionnaire id, version |
| `session.submit_finished` | A submit decided: accepted, replayed, rejected for validation, rejected for a conflict, or failed | + outcome; for a validation refusal also `findingCount` and `omittedCount` |
| `reporting.responses_listed` | An admin lists a questionnaire's sessions; no audit row | questionnaire id |
| `reporting.response_viewed` | An admin opens a session's answers; the `view_response` audit row is written in the same transaction | questionnaire id, session id |
| `session.abandoned` | The page is hidden with a session in progress and not submitted, once per session (§6) | + last item id |
| `page.loaded` | The respondent's page finished loading; emitted by the browser after first paint, log line and a duration histogram, no counter (§6) | route template, `durationMs` |
| `session.completed` | Submitted | + duration, question count |

A request that fails many items would otherwise emit one line per item, so per-item lines are capped at `MAX_FINDINGS` (20, one constant in `@qp/telemetry`) and the counters never read them. The indicator for a capped request is the pair of numbers on the outcome event, `findingCount` (the real total) and `omittedCount` (findings past the cap, 0 when there are `MAX_FINDINGS` or fewer), and the per-code events carry each code's real count as `codeFindingCount`, which is what the two rejection counters add. `codeFindingCount` is one code's share and `findingCount` the request's total, two fields so that a query never sums one across the other. All three are registry fields that accept only whole numbers, so they cannot carry text, and they are never metric labels (O6).

`session.abandoned` and `session.item_skipped` are the two that make the drop-off question answerable — the reason the design keeps a server-side session record at all ([[2-design-doc#8. Sessions & Responses]]). `session.item_skipped` carries no separate predicate id: predicates have no identity of their own, so the item they hid is what names which predicate fired ([[2-design-doc#17. Decisions Log]] #41).

## 5. Audit trail

**An audit trail is not an application log.** Different consumers, different retention, different integrity requirements. "Who published version 3, and when" must survive log rotation, log-pipeline outages, and a decision to cut logging costs. It belongs in the database.

Contents: actor, action (`publish` / `retire` / `edit_draft`), target (questionnaire id, version), timestamp, and a before/after summary for edits. Append-only — no `UPDATE`, no `DELETE`.

### 5.1 Isolation — separate schema with a restricted role

**Decision:** an `audit` schema in the same Postgres instance, owned by a dedicated `NOLOGIN` role and reachable only through a `SECURITY DEFINER` function. Append-only becomes a **database guarantee** rather than a convention the application is trusted to follow, and the audit write joins the transaction that performs the domain change.

The mechanism landed stronger than this section originally described. Narrowing grants on the application role to `INSERT` and `SELECT` was the first form, and it works; it was superseded by one that costs the same and gives more (Decisions Log #24, [[9-database-schema#9.1 A dedicated role, inside the publish transaction]]). `audit_owner` owns the table and the function, has no login, and `qp_definition` holds **zero** privilege on `audit.event` — not `INSERT`, not even `SELECT`. Append-only stops being "a role that was only granted `INSERT`" and becomes "a table no application role can reach at all, behind one function that only appends".

`qp_reporting` also holds `EXECUTE` on that function (O14), and is limited to one action and one payload shape: `audit.record` refuses a call whose `session_user` is `qp_reporting` unless the action is `view_response` and the `summary` is exactly `{"sessionId": <uuid>}`, with a null-free reference triple and a trace id that is `NULL` or 32 hex digits (migration `0022`, A1; [[9-database-schema#9.1 A dedicated role, inside the publish transaction]]). The repository function `recordResponseView` writes only that row, so the limit holds in code and in the database independently. What the database cannot enforce is `actor_id`, which the caller supplies until authentication lands. Nothing on this path is telemetry.

That second property is the reason this beats a separate database today. Publishing already runs as a single transaction ([[2-design-doc#12.1 Authoring is normalized; published is a snapshot]]); a separate database would put the audit write outside it:

> Publishing version 3 and recording "user X published version 3" become two operations that can fail independently — so a publish can succeed with no audit record, which is precisely the failure an audit log exists to prevent.

The isolation that actually matters here — a separate access path, separate grants, immutability the application cannot override, and a retention policy decided independently of application data — a schema plus a restricted role already provides. A separate database adds physical separation and costs atomicity to get it.

**The deferred option: separate database + transactional outbox.** When the audit trail needs to be operated, backed up or access-controlled genuinely independently — or extracted into its own service — the move is: the domain transaction writes to an `audit_outbox` table in its own database, and a relay ships rows to the audit store and marks them shipped. Atomic at the point of truth, eventually consistent at the destination. That outbox *is* the seam the standalone service is extracted along — the relay becomes a publisher, the audit service becomes a consumer.

**Two things to get right now so that move stays cheap**, both free today:

- Audit writes go through a single repository function rather than being scattered inline at each call site, so the writer can be swapped for the outbox behind one interface.
- Audit rows carry their own identifier and timestamp rather than borrowing the domain row's, so they remain meaningful once they live somewhere else.

### 5.2 Why not pgaudit

Considered after the mechanism above was built, and rejected as a replacement (Decisions Log #98). `pgaudit` logs SQL statements to the Postgres log, which does not fit what this trail is for:

- **Statements, not domain events.** A publish shows up as an `INSERT` by `qp_definition`, not "user X published version 3" with a before/after summary and a `trace_id`. The human actor is invisible unless it is passed through `SET LOCAL` and parsed back out of the log.
- **A log, not a table.** It loses the durability and same-transaction properties this section relies on, and it records statements that later roll back, where our audit row rolls back with the change it describes.
- **Not queryable by the application**, which the `view_response` action (O14) and the responses browser need.
- **Hosting.** It needs `shared_preload_libraries`, which a managed Postgres provider may not permit.

It does see what this design cannot: direct database access, and the accepted gap where `qp_owner` calls `promote_draft` without an audit row ([[9-database-schema#4.3 Publishing goes through `definition.promote_draft`]]). If that matters later, object-level `pgaudit` on the `definition` tables is a backstop beside the `audit` schema, not instead of it.

## 6. Client-side telemetry

The SPA receives the whole questionnaire and evaluates branching rules in the browser, keeping partial answers client-side. **A consequence worth stating plainly: the server never observes most navigation decisions.** Server traces are structurally blind to the respondent's actual path through the questionnaire. Without client telemetry, "which branch did they take before they gave up" is unanswerable.

**Decision: instrument the client.** Traces and logs from the browser, correlated with the backend.

- `@opentelemetry/sdk-trace-web`, propagating `traceparent` on API calls. Each app adds the header by hand in its one `fetch` wrapper, with `injectTraceHeaders` from `@qp/telemetry/browser`, rather than through `@opentelemetry/instrumentation-fetch` patching the global `fetch` (O12). The wrapper runs the request inside a `browser.request` span named by method and route template, and builds its headers before its first `await`, because the context manager is synchronous. Because the nginx proxy keeps the app single-origin ([[2-design-doc#13. Deployment]]), this needs no CORS header allowances — a small dividend of that deployment choice.
- **Tracing is opt-in, so a build that does not use it does not ship the web tracer.** `@qp/telemetry/browser` never imports `sdk-trace-web`; `@qp/telemetry/browser-tracing` does, and an app loads it with a dynamic `import()` only when its build sets `VITE_TELEMETRY_TRACING=true` (the frontend image takes it as a build argument). With it off, no span is recording, so `injectTraceHeaders` adds no `traceparent` and the queue stamps none. A test reads the respondent's static import graph and fails if it reaches `sdk-trace-web` or the tracing entry point.
- Domain events from §4 that only the browser can see (`session.abandoned`, `page.loaded`) are emitted from the browser. The server emits `session.item_skipped` and `session.question_answered` for submitted sessions (O11).
- **The admin app reports through the same SDK, and its screens are route templates.** The router names the screen: the matched route's id (`/questionnaires/$questionnaireId/responses/$sessionId`), which the queue stamps as `route`; a path no route matches names none. Two things report, and both take an error and nothing else, so a message, a cache entry or a `Problem` cannot be passed: React Query's query and mutation caches report a failure that the screen does not handle (a network error, a response that is not a problem, a 5xx problem; not a 4xx problem, which a screen shows, nor a cancelled request) as a `client.warn` line carrying the error's class and frames, and the router's `defaultOnCatch`, with an app-level error boundary behind it, reports a component error as a `client.error` line with its class and frames. The router's `defaultErrorComponent` is the app's own fallback, which shows no message, because the default one prints it. No React Query devtools are installed, and a cache is never serialized (O19).
- **`session.abandoned` is emitted when the page is hidden** (`visibilitychange` to `hidden`, or `pagehide`), before the queue is handed to the beacon, so the event is in the first body sent. It fires only while a session is in progress and not submitted (the form is ready, or a submit failed and can be retried; not while a submit is in flight, which may be accepted). The state cannot tell a submit that failed after the server accepted it from one that did not (the response was lost, or a 5xx followed the commit), so a tab closed on that failure state still emits it, which may be false, once for each session id however often the page is hidden, and carries the session id and the last item the respondent changed (`lastItemId`, a definition item id) and nothing else. A tab hidden and then shown again still counts once, and a session that goes on to complete has both events; the two join on the session id (O11).
- **Page speed: `page.loaded`** carries the route template and `durationMs`, the navigation's duration to the end of the `load` event, in whole milliseconds. The respondent emits it once, after first paint, from the browser's navigation timing entry. The ingest logs it and records the duration in the `browser.page.load.duration` histogram (milliseconds, no labels: a browser controls its own label values, so a route or an error type from one must not become a metric label). The endpoint is unauthenticated, so the histogram is spoofable but bounded: a duration that is negative, not a number or above one hour is not recorded. Because the histogram has no route label, one histogram covers whichever app emits it; only the respondent does.
- **Events batch to a backend `/telemetry` endpoint rather than shipping directly to a Collector.** Three reasons: no publicly exposed unauthenticated collector; the server can stamp trusted server-side context onto client-reported events; and the client path runs through the *same* allowlist filter from §3, so a careless client event cannot leak an answer either: the browser queue applies it before anything is queued (`@qp/telemetry/browser`), and the endpoint applies it again. The endpoint is rate-limited, and the closed schema decides which fields are kept, not whether the batch is (O17).
- **`navigator.sendBeacon` on `visibilitychange`/`pagehide`** to flush pending events when the tab closes. Without it the abandonment event — the one we most want — is the one most likely to be lost, since abandonment and tab-closing are the same user action.

Cost: client telemetry is unauthenticated and therefore spoofable. Acceptable while it feeds product understanding rather than billing or access decisions; noted so it isn't mistaken for trustworthy input.

## 7. Cardinality and metric hygiene

**Session ids, questionnaire ids and question ids must not appear as metric labels.** Each unique label combination is a separate time series; a per-session label turns one metric into unbounded cardinality and takes the metrics backend down. This is the most common way a well-intentioned observability change causes an outage.

The rule: **high-cardinality identifiers live in traces and logs; metrics carry only bounded dimensions** (endpoint, status class, question type, rule outcome). To get from an anomalous metric to the specific session, use exemplars where supported, otherwise pivot by time window plus the bounded attributes and read the traces. (Exemplar support in the OTel JS SDK is still maturing — worth verifying rather than assuming, with the time-window pivot as the fallback.)

## 8. SLOs and alerting

**SLOs and error budgets are deferred.** Six alerts are pulled forward from this section (O10); they ship as Grafana alert rules, with thresholds and routing in §8.3, and are listed below. Direction for the SLOs, for when we do them:

- Candidate SLIs: availability and p95 latency of questionnaire delivery; submission success rate; publish success rate.
- Alert on **symptoms and error-budget burn**, not causes. Nobody should be paged for CPU; they should be paged because respondents can't submit.
- Distinguish paging alerts (user-visible, needs action now) from ticketing alerts (degradation, handle in hours).
- Health endpoints are separate from metrics and needed regardless (shipped in T0b): `/health/live` (process up) and `/health/ready` (`SELECT 1` on the definition, execution and reporting pools; the migrate Job, not the probe, gates migrations) feed the Kubernetes probes stubbed in [[2-design-doc#13. Deployment]] §13.2.
- Backups are listed under Operations in the brief: backup success/age needs to be a monitored metric, and a restore drill is the only evidence a backup works. Deferred with SLOs.

### 8.1 The six alerts

Shipped in P2 (thresholds, routing and where the rules live are in §8.3). Each pages or tickets on a symptom a respondent or an operator would feel, and each reads a signal another lane built: the submit counters (B1), the request metrics derived from spans (P1, §8.2), the event-loop and pool metrics (D1) and the partition function (D2). P2 wrote the six rules and the one Collector receiver the partition alert needed.

| Alert | Signal it reads | Built by |
| --- | --- | --- |
| Submit success rate drops | The submit outcome counters (`questionnaire.submissions`, by outcome) | B1 (counters), P2 (rule) |
| 5xx rate rises | `traces.span.metrics.calls`, filtered to `http.response.status_code` 500 to 599 (§8.2) | P1 (signal), P2 (rule) |
| p95 latency of the questionnaire definition fetch rises | `traces.span.metrics.duration` for `POST /api/run/sessions` and `GET /api/run/sessions/:sessionId`, the two requests that return a definition (§8.2, §8.3) | P1 (signal), P2 (rule) |
| Event-loop lag stays high | `nodejs.eventloop.delay.p99` (seconds; the other delay statistics and `nodejs.eventloop.utilization` sit beside it) | D1 (signal), P2 (rule) |
| Requests stay queued for a pool connection | `db.pool.connections.waiting`, one point per `db.pool` | D1 (signal), P2 (rule) |
| Fewer than one month of future `response` partitions remain | `monitor.response_partition_months_ahead()`, read as `qp_monitor` by the Collector's `sql_query` receiver as `qp.monitor.response_partition_months_ahead`; the alert fires on a value below `1` (§14, [[9-database-schema#10.1 `qp_monitor` and the `monitor` schema]]) | D2 (function), P2 (receiver and rule) |

The last row is the one nothing else would catch: a missing partition fails every submit while every process is up ([[9-database-schema]]).

### 8.2 Request metrics from spans

The SDK's Fastify instrumentation emits spans and no HTTP metrics, so `http.server.request.duration` does not exist. The Collector derives the request metrics instead: its `span_metrics` connector reads the server-kind spans (Fastify's `request` span) on the traces pipeline before tail sampling, so sampling never thins the counts (§10). Each metric carries three dimensions, all registered fields that survive the SDK's export scrub: `http.route` (a template such as `/api/run/sessions/:sessionId`, never a URL), `http.request.method` and `http.response.status_code`.

| Metric (OTLP name) | Type | Dimensions |
| --- | --- | --- |
| `traces.span.metrics.calls` | counter, cumulative | `service.name`, `span.name`, `span.kind`, `status.code`, `http.route`, `http.request.method`, `http.response.status_code` |
| `traces.span.metrics.duration` | histogram in milliseconds; buckets 5, 10, 25, 50, 100, 250, 500 ms, 1, 2.5, 5, 10 s | the same |

A span reports `status.code` `STATUS_CODE_ERROR` on a 5xx and when an error reaches Fastify's `onError` hook, which a thrown error does and a failed schema validation may; a problem response a handler returns, such as a `404` or a `409`, is not an error. A request that matches no route has no `http.route`. The Collector drops the server spans of `/health/live` and `/health/ready` before the connector, so the probe the backend's healthcheck sends every five seconds is not counted (the sampler keeps a probe trace only if it failed or was slow, §10). LGTM's Prometheus receives these through OTLP and may rename them (`traces_span_metrics_calls_total`, `traces_span_metrics_duration_milliseconds_bucket` is the usual translation); §11.2 lists the names the dashboards and alerts use and how they are derived; a person confirms them in Explore. The Collector config is `observability/collector.yaml`.

### 8.3 Thresholds, routing and where the rules live

The six alerts of O10 are Grafana alert rules in `observability/grafana/alert-rules.yaml`, one group, evaluated every minute against the Prometheus that `grafana/otel-lgtm` runs. The rules are Grafana-managed rather than Prometheus rules because the image's Prometheus has no Alertmanager and its configuration file belongs to the image, while Grafana loads a rule file dropped into its provisioning directory without replacing anything (§11.2). Every rule reads only aggregate series whose labels are on the registry's allowlist (§8.2, §11.2), carries a `severity` label and three annotations, `summary`, `description` and `first_look`, the last naming the dashboard and panel to open first.

| Alert | Fires when | For | Severity | No data |
| --- | --- | --- | --- | --- |
| Submit success rate drops | (`accepted` + `replayed`) / (`accepted` + `replayed` + `rejected_validation` + `failed`) of `questionnaire.submissions` is below 85% over 15 minutes, with at least 10 of those submissions | 15 min | page | healthy |
| 5xx rate rises | `traces.span.metrics.calls` with a 5xx status is above 2% of all requests over 10 minutes, with at least 20 requests | 10 min | page | healthy |
| p95 of the questionnaire definition fetch rises | p95 of `POST /api/run/sessions` and `GET /api/run/sessions/:sessionId` is above 1000 ms over 10 minutes, with at least 20 requests | 10 min | ticket | healthy |
| Event-loop lag stays high | `nodejs.eventloop.delay.p99` is above 0.2 s | 10 min | ticket | healthy |
| Requests stay queued for a pool connection | `db.pool.connections.waiting` is above 0 for a pool | 5 min | ticket | healthy |
| Fewer than one month of future `response` partitions remain | `monitor.response_partition_months_ahead()` is below 1 | 15 min | page | fires |

**Why these numbers.** They are first guesses for a prototype with little traffic, and each is one line in the rule file to change.

- *Success rate.* A `rejected_validation` counts against success even though most are the respondent's own mistake, because a client or definition change that rejects everyone looks the same and is exactly what a respondent feels. A replay counts as success: it means the first attempt landed. `rejected_conflict` is left out of both sides of the ratio. It covers a double submit (`already-submitted`) and a submit after the questionnaire closed (`closed`), and neither is an outage: a close would page the moment a popular questionnaire retires, and double clicks would page on a quiet hour. The cost of the hard cutoff is watched where it is counted, in `questionnaire.sessions.rejected_past_cutoff` (the "Refused past the cutoff" stat of the Respondent funnel dashboard), which has no alert because the decision to close is deliberate. 85% leaves room for ordinary validation errors, and the 10-submission floor, counted on the same four outcomes, stops one failed submit from paging on a quiet hour.
- *5xx rate.* Two percent for ten minutes is well above the noise a healthy backend produces and well below an outage. The 20-request floor is the same guard. Health probes are removed before the count (§8.2), or the healthcheck's own five-second request would dilute the ratio.
- *Definition fetch.* The respondent never calls a definition endpoint: the definition arrives inside `POST /api/run/sessions` and `GET /api/run/sessions/:sessionId` ([[3-scaling#Levers, in order]]). Those two routes are the fetch, and the p95 of both together is the signal. A second is the default of the tail sampler's slow threshold, `QP_TRACE_SLOW_MS` (§10), and a bucket boundary of the duration histogram; this alert's 1000 ms is a separate number in the rule file that agrees with the default and does not follow it if the variable changes. The `POST` also writes the session row, so a slow insert shows here too.
- *Event loop.* The metric is the 99th percentile of the delay within each export window. Two hundred milliseconds sustained for ten minutes means the process is blocked often enough that requests wait; a single spike would not hold it that long.
- *Pool queue.* The gauge is sampled once per export interval (60 seconds), so "above zero at every sample for five minutes" is a sustained queue, and one transient wait is not. Each pool alerts on its own.
- *Partitions.* The function counts the months after the current one that a partition covers without a gap, and the migrate job keeps 24 of them, so a healthy database reads 24 to 35. O10 fixes the alert as "fewer than one month", so the rule is `< 1` and pages only at 0, up to a month before the first failed submit. A longer lead, a ticket at 6 or 12 months, is a threshold an operator can add as a second rule on the same series; it is not shipped. It cannot tell a current-month-only runway (up to a month left) from no partition at all (submits failing now), because it returns 0 for both; the rule is a page for that reason. A silent monitor also fires: if the Collector cannot read the function, the alert that nothing else would catch is blind. It waits 15 minutes so a Collector restart does not page.

**What the windows mean.** On the first two rules `for` equals the query window (15 and 10 minutes), so a fault has to be present for the whole window before the query crosses the threshold and then hold for `for`: detection takes about the window plus `for`, roughly 16 and 11 minutes with the evaluation interval. A short burst of errors at low volume can page on the first two rules as soon as the traffic floor is met, because a couple of failures are a large share of ten submissions. The floors, 10 counted submissions per 15 minutes and 20 requests per 10 minutes, may never be met at demo scale, which makes those two rules silent by design there. All of these numbers are guesses to tune against real traffic.

**Page or ticket.** §8 says to page on what a respondent feels and ticket what is a cause. The submit rate, the 5xx rate and a missing partition are what a respondent feels (a partition failure is every submit). The definition fetch's latency, event-loop lag and the pool queue are early signals that a page would follow, so they ticket. The `severity` label is the only routing the files carry: contact points and notification policies name people and endpoints, so they are set up in Grafana per environment (Alerting, Notification policies), routing `severity=page` to the on-call contact and `severity=ticket` to the tracker. Until then a firing rule shows in the Alerting page and goes to Grafana's default contact point, which sends nothing.

**What none of them can see.** All six read aggregates. A rule cannot show a session, an answer or an id, and the series they read carry only the bounded labels of §7.

## 9. Correctness and invariant monitoring

**Deferred deliberately — circle back.** Recorded here so the reasoning isn't lost.

A class of failure produces **HTTP 200 with a plausible-looking body**. No exception fires, no status code is wrong, and nothing in §2 moves. The structural design already removes the worst of it — cycles and deadlock are unrepresentable, and three checks run inside the publish transaction ([[5-questionnaire-format#5. Publish-time validation]]). What remains is **runtime drift**, which publish-time validation cannot see:

| Candidate gauge | What it catches |
| --- | --- |
| `invariant.orphaned_answers` | A stored answer whose `questionId` / `optionId` is absent from the snapshot it pins to. Should be impossible — worth proving rather than assuming, since it is silent when it isn't. |
| `invariant.never_shown_items` | Items no respondent has seen in a live version: the authoring mistake that publish-time check #2 only partially catches, because general satisfiability isn't attempted there. |
| `invariant.snapshot_format_versions` | Which `formatVersion`s are actually live, by count. Turns the support-window question ([[2-design-doc#18. Open Questions]] §4) from a judgement call into a measurement. |

One metric is worth adding **now** rather than deferring, because it measures the cost of a decision already taken:

- `questionnaire.sessions.rejected_past_cutoff` — sessions started before `closes_at` and submitted after it, i.e. respondents who lost completed work to the hard cutoff ([[2-design-doc#8.1 Questionnaire lifecycle and retirement]]). It counts submit attempts refused as closed, not distinct sessions: a respondent who retries is counted each time, and one session can be counted more than once. That count is the whole argument for or against making `cutoffMode` configurable, and right now that open question would be settled on intuition instead.

Two things were separated during this discussion and are worth keeping separate:

- **Status-code discipline** — validate at the edge with TypeBox so malformed input cannot reach a handler, and surface failures as 4xx — is a good API principle and belongs in [[2-design-doc#9. API / Service Boundary]]. It does not detect anything in the table above, because those requests are well-formed and succeed.
- **Eliminating 5xx is not the goal.** When Postgres is down a 5xx is the correct answer; converting infrastructure failure into a 4xx hides it from the error budget and misattributes the fault to the client.

## 10. Sampling, retention, cost

- **Tail sampling in the Collector (P1, shipped): every error trace, every slow trace, and a configurable share of the rest. It ships at 100%.** The decision is made after the whole trace has arrived, which is the only way to keep a trace *because* it failed or was slow. A head sampler cannot do this: it decides at the first span, before the outcome exists. The `tail_sampling` processor holds a trace for `decision_wait: 10s` and keeps it when any of three policies say so:
  - `errors`: a span in the trace has status `ERROR`, which `@fastify/otel` sets for a 5xx and when an error reaches Fastify's `onError` hook, and `pg` sets for a failed query.
  - `slow`: the trace lasted longer than `QP_TRACE_SLOW_MS` milliseconds (default 1000), from its earliest span start to its latest span end. A second is well past what a respondent-facing request should take, and it is a bucket boundary of the duration histogram (§8.2).
  - `baseline`: `QP_TRACE_SAMPLE_PERCENT` percent of traces (default 100), chosen by hashing the trace id, and only traces that have no span on `/health/live` or `/health/ready`. The rule is an `and` of a `probabilistic` policy and a `string_attribute` policy with `invert_match`, which is satisfied by a trace in which no span carries one of those routes.
- **Both numbers are environment variables** (`.env.example`, passed to the `collector` service), read by the Collector as `${env:QP_TRACE_SAMPLE_PERCENT:-100}` and `${env:QP_TRACE_SLOW_MS:-1000}`. It ships at 100% because the prototype's volume is small and a sampled-away trace is one nobody can look at; errors and slow traces are kept whatever the share, so lowering it as volume grows costs only the ordinary ones. The request metrics (§8.2) count every request at any share.
- **Health probes.** The backend's healthcheck calls `/health/ready` every five seconds, and each call runs a query on three pools. A probe that succeeds quickly matches none of the three policies (the baseline excludes it, and it is neither an error nor slow), so it is dropped even at 100%. A probe that fails carries an `ERROR` span, and one that is slow crosses the threshold, so both are kept. There is no `drop` policy: a drop overrides the others and would hide a failing readiness check.
- Because the Collector decides, the SDK exports every span. Today nothing samples (the SDK default is parent-based always-on) and nothing exports either unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (§11). Tail sampling needs every span of a trace to reach the same Collector, so a second Collector replica would need trace-id-aware routing in front of it; one Collector is enough here. The request metrics (§8.2) are computed before the sampler, so they count every request.
- The redaction processor removes attributes, including resource and scope attributes, and nothing else. A span's name, a span event's name, a span link's attributes, a status message, an exemplar, a metric's name and a log record's body pass through it unchanged, so they rest on the SDK's scrub (§3.1) and, for a log body, on the Collector's message filter (§11). For a log record the SDK's exporter does more: it scrubs the attributes of the record's instrumentation scope, keeps a severity number only from the four level numbers, and does not export the record's `event_name`. Every pipeline that exports to the store has a redaction stage, including the two that carry metrics the Collector makes itself (§11). The residual case is a client that is not our SDK: anything on the Compose network can post to the Collector's OTLP port, and nothing but the SDK's own scrub stops such a client putting a value in a name. The port is published on `127.0.0.1` only.
- Logs are the expensive signal. Domain events at `info` are low-volume by construction; rule-evaluation detail stays at `debug` and off in production.
- Response *data* retention is a separate question from telemetry retention and is governed by the domain, not by operations.

## 11. Local and hosted setup

The prototype must stay one command ([[2-design-doc#13. Deployment]]), so the observability stack does not become four more containers a reviewer has to run.

- The SDK is always wired with OTLP exporters, controlled by `OTEL_EXPORTER_OTLP_ENDPOINT`. Unset, the app runs with instrumentation active and export disabled — zero friction for `docker compose up`.
- A **Compose profile** (`docker compose --profile observability up`) adds two containers (O15): an OTel Collector (`otel/opentelemetry-collector-contrib`, pinned) and `grafana/otel-lgtm` as the local trace, log and metric store with its UI. Opt-in, so the one-command demo stays one command (O7). Both services carry `profiles: ["observability"]`, and the default `docker compose up` starts exactly what it started before. What P1 shipped:
  - **The Collector** (`observability/collector.yaml`): an OTLP/HTTP receiver on `4318` for the backend's traces, metrics and logs, and a `postgresql` receiver connecting as `qp_monitor`. **Every pipeline that exports to the store has a redaction stage**, and a test fails for a new pipeline that has none: `redaction` keeps exactly the attributes in `ALLOWED_ATTRIBUTES` (`packages/telemetry/src/fields.ts`, compared with the YAML by a test, O17) for the backend's signals and again on the traces that leave the sampler; `redaction/derived` keeps the three `span_metrics` dimensions and the connector's own attributes (`span.name`, `span.kind`, `status.code`) on the request metrics; `redaction/postgresql` keeps the attributes of the `postgresql` receiver's default-enabled metrics at v0.160.0 and its resource (database, schema, table and index names, server address and port, instance id), so an attribute a later receiver option adds, such as the statement text of its query-sample and top-query events, is removed by default. Those two events stay disabled, and a test says so. The `span_metrics` connector (§8.2), tail sampling (§10), and `service.version` stamped from `QP_SERVICE_VERSION` (default `dev`) on every pipeline that exports, after its redaction, which removes any `service.version` the SDK sent (L1 owns the SDK side and would need the key allowed in `allowed_keys` and the registry's list first). It exports to LGTM over OTLP/HTTP. Vendors change here and nowhere else (O9). The Collector runs as the image's own user, mounts only its config, and reads no container's files.
  - **Turning export on**: the backend's `OTEL_EXPORTER_OTLP_ENDPOINT` is empty by default. Set it to `http://collector:4318` in `.env`, and start with `--profile observability`. Compose passes `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` and `LOG_LEVEL` through, and `.env.example` has an Observability block.
  - **A backend healthcheck** on `/health/ready`, run with `node` (the image has no `curl`). The frontend does not wait for it (`depends_on` stays as it was), because nginx resolves `backend` when it starts and the healthcheck would add a start condition to the default stack.
  - **The nginx access log** (`deploy/frontend/nginx.conf`, §11.1).
  - **Dashboards and the six alerts** (P2): four Grafana dashboards, Service health, Respondent funnel, Admin and authoring and Database, and the six O10 alert rules, provisioned from `observability/grafana/` into the `lgtm` service (§11.2, §8.3). The Collector also reads `monitor.response_partition_months_ahead()` with a `sql_query` receiver as `qp_monitor`, which the partition alert needs.
- **Logs reach the Collector as OpenTelemetry log records the backend emits.** The logger's sink already runs the registry scrub before it writes a pino line; when an endpoint is configured it also emits an OTel log record from the same scrubbed record: the level as severity, the literal message as the body, the registered fields as attributes, and the active span's context as the record's trace context, so a log line and its trace join on `trace_id`. pino's stdout output is unchanged. The record leaves through `scrubbingLogExporter`, which mirrors the span and metric exporters: attributes through the registry scrub again, a severity text only from the four level names, and a body kept only if it has the literal-message shape (`LOG_MESSAGE_SHAPE`, `^[A-Za-z][A-Za-z0-9 ._:,/-]{0,127}$`) and replaced by `unnamed` otherwise, counted as an `invalid` drop. The Collector adds redaction, a filter that drops any record whose body fails the same shape (a test compares the two), the stamp, and the export. The browser's events reach the same path, because `/api/telemetry` relays them through the logger. Because the leak test's exporter sees these records, a sentinel in one fails it (`docs/8-testing.md` §7). The shape is a shape check: a one-word answer passes it, as a one-word span name does; the guard is that no code builds a message from a value.
- **Rejected: the Collector reading Docker's JSON log files** (`file_log`). An earlier version did. It needed the Collector to run as root with every container's log files mounted, a label and an explicit log driver on the app services, and a parser chain that re-derived what the SDK knows; the leak test could not see any of it, and the `db` container's file was read even though it was discarded. It was first rejected in favour of that design because an SDK logs bridge would duplicate the scrub; it does not, because the sink runs after the call-time scrub and the exporter runs the export-time scrub, the pattern spans and metrics already follow. The fallback if the in-process emit ever proves unworkable is `pino-opentelemetry-transport`, which sends from a worker thread and gives up the leak test's view.
- Database settings that need a restart are not in the profile: `pg_stat_statements` is on in the `db` service always (O16, §14).
- Hosted: the Collector is the only thing that knows the vendor. Application code never does.

### 11.1 The nginx access log

`deploy/frontend/nginx.conf` writes one JSON line per request to the container's stdout (`docker compose logs frontend`), and nothing else: `msg`, `http.request.method`, `http.route`, `http.response.status_code`, and the `trace_id` and `span_id` of the request's `traceparent` header. The line is **not sent to the Collector** (L5). Its keys are registry attribute names, so a future ingest would keep them. The line has no query string, cookie, referrer, address, user agent or request id. There is no request id: the backend makes its own and does not send it back, so nginx has none to log.

`http.route` is the request path with session ids masked (O13) by `map` blocks over `$request_uri`, so a request that `try_files` rewrites to `index.html` is still logged as the path the client sent:

| Request path | Logged as |
| --- | --- |
| `/api/run/sessions/<anything>` and `/api/run/sessions/<anything>/submit`, with or without a trailing slash | `/api/run/sessions/:sessionId` and `/api/run/sessions/:sessionId/submit` |
| `/api/reporting/questionnaires/<id>/responses/<anything>` | `/api/reporting/questionnaires/<id>/responses/:sessionId` |
| `/admin/questionnaires/<id>/responses/<anything>` | `/admin/questionnaires/<id>/responses/:sessionId` |
| any longer path under `/api/run/sessions/`, `/api/reporting/questionnaires/<id>/responses/` or `/admin/questionnaires/<id>/responses/` | `:unmatched` |
| any other path made only of safe segments (below) | itself, without its query string |
| any other path | `:unmatched` |

A safe segment is `[A-Za-z0-9_-]` characters, optionally with dot-separated parts of the same characters, and optionally led by a colon; a path is safe when it is `/` or a run of `/` and safe segments. A percent sign, a doubled slash, a `.` or `..` segment, a non-ASCII byte, an absolute-form request target (`GET http://host/…`) and an empty target are not safe, so the masks above cannot be bypassed by writing the same path another way: the log says `:unmatched` instead of the path. The status is logged as a JSON number, and nginx's `000` (a client that closed the connection) as `0`.

The slot is masked whatever it holds, not only a UUID. The `cursor` parameter (O19) is masked by omission: the query string is never logged, so `cursor` cannot be, and neither can any other parameter. A regular expression over one named parameter misses a repeated or percent-encoded name; leaving the query out cannot. The trace and span id are read out of `traceparent` by a `map` that accepts only a version `00` header of lower-case hex with non-zero ids, so a client cannot put text of its choosing into the log through that header. `tests/nginx-access-log.test.ts` runs the masking rules on the path of every shared route that carries `:sessionId`, built with `routePath` under its API prefix, so a renamed or added session route fails it, and on each bypass listed above; it also asserts the variables the log format may read.

### 11.2 Dashboards and alerts as files

`grafana/otel-lgtm` provisions from files at startup: its Grafana reads `/otel-lgtm/grafana/conf/provisioning/dashboards/*.yaml` (providers that name a dashboard directory) and `.../alerting/*.yaml` (alert rules, contact points, policies), and its Prometheus receives OTLP metrics on the same container. The `lgtm` service mounts three read-only files from `observability/grafana/`, each beside what the image ships, so none of the image's own dashboards or data sources is replaced:

| File | Mounted at | Holds |
| --- | --- | --- |
| `dashboards.yaml` | `.../provisioning/dashboards/qp-dashboards.yaml` | A file provider for the folder "Questionnaire platform", reading `/otel-lgtm/qp-dashboards` |
| `dashboards/*.json` | `/otel-lgtm/qp-dashboards` | Service health, Respondent funnel, Admin and authoring, Database |
| `alert-rules.yaml` | `.../provisioning/alerting/qp-alert-rules.yaml` | The six alerts (§8.3) |

A dashboard is edited in the file and reloaded within 30 seconds; the provider does not allow saving from the UI, so a change made there is not kept. Alert rules are read at Grafana's startup, so a change to `alert-rules.yaml` needs the `lgtm` container restarted (or an admin reload of the alerting provisioning through Grafana's API). `dashboards.yaml` and `alert-rules.yaml` are mounted as single files, and an editor that saves by replacing the file leaves the container looking at the old one: recreate it (`docker compose --profile observability up -d --force-recreate lgtm`) after such an edit. The panels read the Prometheus (uid `prometheus`) and, for one logs panel, the Loki (uid `loki`) data sources the image provisions.

**Series names.** The image's Prometheus turns an OTLP name into its own: dots become underscores, a unit adds a suffix (`ms` `_milliseconds`, `s` `_seconds`, `By` `_bytes`, and `1` on a gauge `_ratio`; a unit in braces adds none), a counter adds `_total` unless the name already ends in it, a histogram adds `_bucket`, `_sum` and `_count`, and an attribute becomes a label the same way. These are the series the dashboards and alerts read:

| Series | Comes from | Labels used |
| --- | --- | --- |
| `traces_span_metrics_calls_total`, `traces_span_metrics_duration_milliseconds_bucket` and `_count` | the Collector's `span_metrics` connector (§8.2) | `http_route`, `http_request_method`, `http_response_status_code` |
| `questionnaire_sessions_started_total`, `_resumed_total`, `_completed_total`, `_abandoned_total`, `_rejected_past_cutoff_total`; `questionnaire_items_skipped_total` | domain counters (§2.2) | none |
| `questionnaire_submissions_total`, `questionnaire_publish_total` | domain counters | `questionnaire_outcome` |
| `questionnaire_answers_accepted_total`, `questionnaire_answers_rejected_total`, `questionnaire_publish_rejections_total` | domain counters | `questionnaire_question_type`, `questionnaire_reason`, `problem_code` |
| `questionnaire_created_total`, `_published_total`, `_retired_total`, `_draft_conflicts_total`, `_responses_listed_total`, `_responses_viewed_total` | domain counters | none |
| `questionnaire_session_duration_milliseconds_bucket` | the session duration histogram | none |
| `telemetry_scrub_dropped_total`, `telemetry_ingest_dropped_total` | the scrub and the ingest | `telemetry_signal`, `telemetry_reason`, `telemetry_ingest_reason` |
| `db_pool_connections_total`, `_idle`, `_waiting` | D1 pool gauges | `db_pool` |
| `nodejs_eventloop_delay_p99_seconds` (and `_max_`, `_p50_` and the others), `nodejs_eventloop_utilization_ratio` | D1 runtime instrumentation | none |
| `db_client_operation_duration_seconds_bucket`, `_count` | D1 `pg` histogram | `db_operation_name` |
| `qp_monitor_response_partition_months_ahead` | the Collector's `sql_query` receiver, reading `monitor.response_partition_months_ahead()` as `qp_monitor` every minute | none |
| `postgresql_backends`, `_connection_max`, `_db_size_bytes`, `_commits_total`, `_rollbacks_total` | the Collector's `postgresql` receiver | none |

`tests/observability-dashboards.test.ts` derives this list from the Collector config, `packages/telemetry/src/events.ts` and `instruments.ts`, the names D1 exports (`POOL_METRICS`, `EVENT_LOOP_METRIC_NAMES` and `PG_OPERATION_DURATION`, imported from `@qp/telemetry`) and a list of the `postgresql` receiver's names, and fails when a dashboard or alert query reads a series or label outside it, so a rename fails CI. It does not run a query. **Only a person running the profile can confirm the exact names**, and the units of the runtime and pool gauges in particular: after `docker compose -f docker-compose.yml --profile observability up`, open Grafana, Explore, choose Prometheus, and look each name up in the metric browser.

The `sql_query` receiver connects as `qp_monitor` to host `db`, as the `postgresql` receiver does, and its one metric has no attribute. It runs through its own redaction stage, `redaction/monitor`, whose allowlist is empty: the query has no attribute column, so anything the receiver attached would be removed. The rule that every pipeline that exports has a redaction stage covers it without an exception.

## 12. Change correlation and synthetics

**Noted as production practice; out of scope for the prototype.**

- Deploy and migration markers annotated onto dashboards — most incidents are change-caused, and "what changed at 14:02" is the first question in every one of them. Nothing in Track 8 builds this: it needs a build identity on every signal, which is L1 (§13, [gh#117](https://github.com/kenziesimpson/questionnaire-platform/issues/117)).
- A synthetic leak test completing the medical-condition demo questionnaire end to end every few minutes: the only signal that proves the *workflow* works rather than that the processes are up. Cheap to build here because the demo questionnaire already exists, which is why it's worth mentioning even while deferring it.

## 13. Decisions and open questions

### Decided

| # | Decision |
| --- | --- |
| O1 | OpenTelemetry as the single instrumentation standard; Collector as the vendor seam; `@fastify/otel` on the backend |
| O2 | Respondent answer values never enter telemetry, enforced by the ladder in §3 — `Sensitive<T>` type, single telemetry boundary + lint rule, exporter scrub, sentinel leak test, CI gate, advisory agent review, `telemetry-safety` skill |
| O3 | Domain events (§4) as a first-class stream, emitted as a log, and a counter unless the event is log-only or counted by a payload field |
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
| O14 | Reading a response's raw answers writes an audit row now, not only a log event: a new `view_response` action, recorded through `audit.record` in the same transaction as the read, so a failed audit write fails the read. The actor is the placeholder author until authentication lands. Amends [[2-design-doc#17. Decisions Log]] #89, since `qp_reporting` gains `EXECUTE` on `audit.record` beside its `SELECT` grants. How the session id is stored on the row (in `summary` or a new column) is left to the implementing PR. 2026-09-18. As built, the grant is limited to that one action: migration `0022` (A1) makes `audit.record` raise `42501` when `session_user` is `qp_reporting` and the action is anything but `view_response`, so the limit no longer rests on the repository function alone. It also refuses, for that role, any `summary` but `{"sessionId": <uuid>}` and a trace id that is not `NULL` or 32 hex digits. |
| O15 | The `observability` Compose profile adds two containers: an OTel Collector and `grafana/otel-lgtm` as the local trace, log and metric store with its UI. 2026-09-18 |
| O16 | `pg_stat_statements` is enabled in the `db` service by default, not only in the profile, since it needs `shared_preload_libraries` and so a restart to turn on later. 2026-09-18 |
| O17 | Unknown telemetry fields are dropped, not rejected. The `/telemetry` endpoint keeps each event, strips any field outside the registry (O8) and counts it in `telemetry.ingest.dropped{reason}`; the Collector's redaction processor does the same. Fields change expand-then-contract: a new field is allowed in the Collector before any build sends it, and removed from the Collector only after no deployed build sends it. A browser tab left open across a deploy then loses one field rather than all its telemetry. Amends §6's "validates against the same closed schema": the closed schema decides what is kept, not whether the batch is. 2026-09-18 |
| O18 | The admin responses browser ([gh#18](https://github.com/kenziesimpson/questionnaire-platform/issues/18), landed in #115) is the one surface that returns raw answers, so O14 applies to it precisely. `GET /api/reporting/questionnaires/:id/responses/:sessionId` (`getSessionDetail`) writes the `view_response` audit row. `GET /api/reporting/questionnaires/:id/responses` (`listSessions`) returns `SessionSummary` rows, which carry only counts, status and timestamps, and writes none; it is a metric and a log line like any other route. `qp_reporting` already exists with `SELECT` only (migrations `0016`, `0017`), so O14's change is a new migration after them that adds the `view_response` action and the `EXECUTE` grant on `audit.record`. The module's "cannot write" property in [[9-database-schema]] becomes "cannot write except through `audit.record`". 2026-09-18. From `0022` the sentence gains a clause: "and only for `view_response`". |
| O19 | The list endpoint's pagination `cursor` is `base64url(direction\|startedAt\|sessionId)`, so it carries a session id in the query string and O13 covers it: spans keep `http.route` only, and nginx's access log masks the `cursor` parameter as well as ids in paths. Telemetry from the admin browser names a screen by its route template (`/questionnaires/$questionnaireId/responses/$sessionId`), never by the URL, and the admin's `/telemetry` events carry no answer text, cursor or query string. The response-detail screen renders answers, so the admin error boundary and any React Query devtools or cache dump stay out of telemetry: a component error reports its type and stack frames only (O8). 2026-09-18 |
| O20 | The sentinel leak test (M7) plants its value in a real stored response and reads it back through `getSessionDetail` and `listSessions`, then asserts it is absent from every exporter, the pino output and the `/telemetry` ingest, in addition to the submit path. The admin's response-detail screen gets a component test that renders a planted answer and asserts nothing reaches the telemetry wrapper. `listSessions` is added to the `pg_stat_statements` and slow-query review: it is the one paged read over `execution.session`, backed by `session_by_questionnaire`, and a regression there shows first as latency on that route. No new alert; the O10 six stand. 2026-09-18 |
| O21 | The `/api/telemetry` rate limit is per client address: an in-process fixed window of 300 requests a minute for each IPv4 address or IPv6 `/64`, checked before the body is read, with the oldest bucket evicted at 10,000 tracked addresses. It reads `request.ip`, so `buildApp` sets `trustProxy: 1` for the one nginx hop in front of the backend; without it every browser would share the proxy's address and one bucket. A body over 64 KiB is a `413` answered as `request/invalid`. Amends §6's "rate-limited". 2026-09-19 |
| O22 | The `observability` profile is a single-machine local stack. Grafana runs with anonymous Admin access (the `grafana/otel-lgtm` image's default) and the Collector's OTLP receiver has no authentication, and both are published on `127.0.0.1` only. That is accepted for the prototype and is **not a hosted configuration**: hosted needs authentication, TLS and a bind address the platform decides. Anything that binds either port to a non-loopback address must revisit this decision. `tests/observability-compose.test.ts` pins the loopback binding so it cannot widen unnoticed. 2026-09-19 |

### Considered and left out

| # | Considered | Why left out | Tracked |
| --- | --- | --- | --- |
| L1 | Build tagging: commit, version and environment as resource attributes on every signal, the client's build recorded beside the server's to measure version skew, source maps per SHA, deploy markers | Nothing in the prototype runs two versions at once. Adding it later touches config, the telemetry resource, the Vite configs and the Dockerfiles, not call sites | [gh#117](https://github.com/kenziesimpson/questionnaire-platform/issues/117) |
| L2 | Recording downstream calls and preparing for the service split: `instrumentation-undici` for outbound `fetch`, a `dependency(name).call()` wrapper giving a client span and a `dependency.duration{dependency, outcome}` histogram, trace-context helpers for queue messages and the audit outbox, and a module tag on spans and metrics | The backend calls nothing but Postgres today. O8's per-module logger already tags logs, and OTel carries trace context across a process boundary without any of this | — |
| L3 | Closing `schema/${string}` to a fixed list of codes in the shared problem contract, so the code is safe as a metric label | Backward compatibility: `problemFromWire` rejects a problem whole, so an old admin tab would reject every body carrying a code it predates. Coupling: every service would share one list. Instead, the telemetry projection maps any code outside its known list to `schema/other`, leaving the wire contract open | — |
| L4 | Strict ingest: rejecting a whole telemetry batch that carries a field outside the registry | A respondent's tab can stay open across a deploy that removes a field, and from then on every batch it sends would be rejected, `session.abandoned` included — the event we most want. Dropping the field (O17) keeps the same guarantee, since nothing unknown is kept either way | — |
| L5 | Ingesting nginx's access log into the Collector | nginx cannot speak OTLP. The route is `access_log syslog:` to a syslog receiver on the Collector, which needs a receiver and a pipeline of its own, and an nginx config that names the Collector's host. nginx resolves that name when it starts, so a Collector that is not running (the default stack, where the profile is off) would break the frontend's startup unless the `access_log` line lives in a profile-gated include. The line stays on stdout, masked and fail-closed (§11.1), where `docker compose logs frontend` reads it | — |

### Open

- SLOs, error budgets, backup monitoring — deferred (§8). The six alerts in O10 are the exception.
- Invariant monitoring design — deferred (§9). One exception worth pulling forward: `questionnaire.sessions.rejected_past_cutoff`, which measures the cost of the hard-cutoff decision.

## 14. Database telemetry

**Shipped in D1 and D2.** Postgres holds the answers, so it is both the most useful thing to observe and the place a value is most likely to slip out. Four layers, each with its own owner and its own way to leak.

| Layer | What it answers | State | PR |
| --- | --- | --- | --- |
| 1. App to database: `pg` spans and pool metrics | Which query in which request was slow, and is a pool the bottleneck | Shipped: `pg` client spans (T0a), `db.client.operation.duration` and the `db.pool.connections.*` gauges | D1 |
| 2. SQL-comment trace ids and `application_name` | Which trace issued a query that Postgres shows me, and which pool ran it | Shipped | D1 |
| 3. Postgres's own stats: `pg_stat_statements` | Which statement shapes cost the most, across all traces | Shipped: loaded and created by default, reviewed with the queries of §14.2 | D2 |
| 4. Domain gauges: the `monitor.*` schema read as `qp_monitor` | Is the data still healthy: partitions remaining, and the invariants of §9 when they are built | Shipped: `monitor.response_partition_months_ahead()`; the invariant gauges stay deferred | D2 |

**1. Spans and pool metrics.** The `pg` instrumentation is started by `startTelemetry` (T0a), and its span names, `pg.query:<verb>`, `pg.connect` and `pg-pool.connect`, are on the exporter's closed list. A span exports `db.system.name`, `db.namespace`, `server.address` and `server.port`. The statement text is on the span as `db.query.text`, which is not on the attribute allowlist, so no SQL text exports; the scrub drops that one attribute from a span without counting it, since every query span carries it. D1 adds the pool gauges of §2.2, `db.pool.connections.total`, `.idle` and `.waiting`, labelled by the bounded `pool` field, which the health probes already use, and registers `instrumentation-runtime-node` for the event-loop metrics. `db.pool.connections.waiting` is the signal behind the pool alert (§8.1). The exporter keeps only `db.client.operation.duration` from the `pg` instrumentation and only the event-loop metrics from runtime-node, because their other metrics carry labels that are not on the allowlist.

**2. Trace ids in SQL, and `application_name`.** D1 turns on the instrumentation's `addSqlCommenterCommentToQueries`, so each statement carries a trailing comment `/*traceparent='00-<trace id>-<span id>-01'*/` naming its own span. A statement seen in `pg_stat_activity` or the Postgres log maps back to its trace. `openDatabase` sets `application_name` to `qp-backend:<pool>` for each of the three pools (`definition`, `execution`, `reporting`), so the same views show which role's pool ran it; the owner's migration and seed connections carry none. The comment carries `traceparent` and nothing else, and the barrier is on the extract side. The instrumentation builds the comment from the span's own context with a private W3C propagator that writes `tracestate` too, and that propagator is not the global one, so nothing we register on inject reaches the comment. What keeps a caller's `tracestate` (up to about 512 bytes, caller-controlled) out is that no span in the process ever carries one: the pipeline registers `TraceparentOnlyPropagator`, whose extract discards `tracestate`, and `@fastify/otel` extracts an inbound request through the global propagator, so the request span's parent, and every span under it, has none. Its inject is defensive only, for anything that propagates outward. It also drops `baggage`, which nothing here uses. A test builds a span from a hostile inbound context and asserts on the instrumentation's own comment output, with a stock W3C extract as the control that does carry `tracestate`, and a test on the real client reads the comment back from `pg_stat_activity`. A future span created under a context that did not come through the global propagator's extract would bypass the barrier. Postgres normalises a statement without its comments, so the comment does not split one statement into many in layer 3. A statement that already contains `--` or `/*` gets no comment (a limit of the instrumentation); the backend's SQL has none.

**3. `pg_stat_statements`.** On in the `db` service by default (O16): the service starts `postgres` with `shared_preload_libraries=pg_stat_statements`, so turning it on later would have meant a restart, and `db/init/01-roles.sh` runs `db/init/pg-stat-statements.sql` (`CREATE EXTENSION IF NOT EXISTS pg_stat_statements` and its grants) in the application database on every `up`, as the bootstrap superuser, so an existing volume gets it too. It stores each statement with its constants replaced by placeholders, so it holds no bound value. `qp_monitor` reads it through `pg_monitor` and an explicit `SELECT`; the script revokes the view from `PUBLIC`, so an application role cannot. `listSessions` joins the review of the slowest statements (O20): it is the one paged read over `execution.session`, and a regression shows there first. §14.2 has the queries.

**4. `monitor.*` and `qp_monitor`.** D2 adds a `qp_monitor` login role (password `QP_MONITOR_PASSWORD`, default `qp_monitor`, a member of `pg_monitor`) and a `monitor` schema of `SECURITY DEFINER` functions that return aggregates only, created by migration `0021`. The first is `monitor.response_partition_months_ahead(as_of timestamptz DEFAULT now())`: the months after the current one that a `response` partition covers without a gap, `0` when only the current month is covered and also `0` when the current month has no partition at all, so the sixth alert fires on `< 1` and cannot tell the two apart (a missing current month is the worse case, and already fails every submit). `qp_monitor` is the one identity telemetry uses to read the database, and it holds no grant on the tables that carry answers, no `USAGE` on their schemas and no `EXECUTE` on their functions. A database test asserts the absence, as it does for `qp_definition` and `qp_reporting` ([[9-database-schema#10.1 `qp_monitor` and the `monitor` schema]]). The §9 invariant gauges stay deferred. A count of in-progress sessions was left out: it scans `execution.session` on every scrape and no alert reads it. The Collector reads the function through the `sqlquery` receiver (P2).

### 14.1 Where a database can leak, and the fix

| Leak | Where a value would appear | Fix | PR |
| --- | --- | --- | --- |
| Parameter logging | A statement logged by duration or error with its `parameters:` line, in the Postgres log | Shipped: the `db` service starts with `log_parameter_max_length=0`. The on-error variant defaults to `0` and stays there. `auto_explain` is not loaded; if it ever is, its `auto_explain.log_parameter_max_length` is set to `0` in the same change, because its plan log carries a parameterised statement's parameters | D2 |
| Error `DETAIL` lines | A constraint failure quotes the value or the whole row (`Key (…)=(…) already exists`, `Failing row contains (…)`), which for a `response` check names the answer | Shipped: `log_error_verbosity=terse`, which drops `DETAIL`, `HINT`, `QUERY` and `CONTEXT` from the log | D2 |
| Statement text in `pg_stat_statements` | The extension keeps each statement's text | It normalises constants in a statement it can parse into a query tree, so a bound parameter never appears. The text of a utility statement (DDL, `SET`) may be kept as written on PostgreSQL 16. No statement the backend issues while serving carries an answer in a utility statement, since answers travel as bound parameters of `INSERT` and `SELECT`; the only literals the backend's DDL carries are partition bounds. A test plants a value as a parameter and finds it nowhere in the view | D2 |
| A role reading the stats | `pg_read_all_stats`, which `pg_monitor` includes, shows every role's statement text and counters: the `pg_stat_statements` views, and `pg_stat_activity.query`, which holds the statement as sent, unnormalised, for every session's running and last statement. The extension grants its views and their functions to `PUBLIC`, where each role sees its own text | `qp_monitor` is the only role granted `pg_read_all_stats`. The roles script (through `db/init/pg-stat-statements.sql`) revokes the two views and the functions behind them, `pg_stat_statements(boolean)` and `pg_stat_statements_info()`, from `PUBLIC` and grants the views and those two functions to `qp_monitor` alone (a view's function is checked as the calling user, so the views alone would not be enough). `qp_monitor` holds no grant on an answer table. What it can read is safe only because the backend always binds values through Parse and Bind, so the text it sees carries `$n`, never a value; a test holds a bound sentinel open in a running statement and reads `pg_stat_activity` as `qp_monitor`. The residual exposure is any future statement built with inline literals instead of bound parameters: its values would show in `pg_stat_activity.query` while it runs and after, in the `STATEMENT:` line of the Postgres log when it errors, and, for a utility statement, in `pg_stat_statements`. | D2 |
| The `STATEMENT:` line of the Postgres log | On an error the server writes the failing statement (`log_min_error_statement` defaults to `error`), and `log_error_verbosity=terse` does not drop it | Not removed by configuration. For a statement with bound parameters the line is the `$n` text, so it carries no value; it would carry one only for a statement built with inline literals. Request validation and bound parameters are what keep values out. V1 owns the test that the Postgres log holds no sentinel | V1 |
| Bound parameters on a span | The `pg` instrumentation's `enhancedDatabaseReporting` option records the parameter values on the span | Shipped: it stays off (`DATABASE_INSTRUMENTATION_CONFIG`, asserted by a test). The export scrub drops any attribute outside the registry as a second guard | D1 |
| Error message, in the application | A `pg` error's message can carry a value (`invalid input syntax for type uuid: "…"`) | Already shipped: an error is recorded as its class name and stack frames, never its message (O8) | T0a |
| Error message, in the Postgres log | The same primary message is written to the server log, and `terse` does not remove it | Not removed by configuration. Request validation runs before a value is bound, which keeps most malformed input from reaching a cast. V1 plants a value and searches the Postgres log for it | V1 |
| SQL text in a span | `db.query.text`, the attribute the `pg` instrumentation puts the statement on | Never exported: it is not on the attribute allowlist, and the scrub drops it from a span silently, without a drop count, because every query span carries it | T0a, D1 |
| Caller-supplied trace headers in the SQL comment | An inbound `tracestate` (or any propagated header) copied into the statement's comment, and so into `pg_stat_activity` and the Postgres log | Shipped: the registered propagator discards `tracestate` on extract, so no span carries one and the instrumentation's own comment cannot; the barrier is the extract side (inject is defensive only, since the comment does not go through the global propagator); tested on the propagator, on the instrumentation's comment output, on a fake driver and on the real client | D1 |
| The leak test cannot see `pg` | `pg` spans did not appear under test, because the driver loads before the instrumentation | Shipped: the leak harness hands the driver the app loaded to the pipeline, which patches it (`patchLoaded`), so every flow runs with the `pg` instrumentation on. The sentinel is a SQL parameter in the definition flows (a questionnaire title) and the submit flows (an answer), and a `database:` flow binds it in statements that succeed and in statements the driver rejects with the value in its message, which the span's status message carries before the exporter drops it. A mutation test removes the export scrub and shows the gate then fails on a `pg` span | D1 |

The Postgres-log rows are outside the application's pipeline, so the scrub cannot help there: only the configuration, and V1's test of Postgres's own log, stand between a value and that file.

### 14.2 Reviewing slow statements

Run as `qp_monitor` (`psql "postgres://qp_monitor:$QP_MONITOR_PASSWORD@localhost:${POSTGRES_PORT:-5432}/$POSTGRES_DB"`), against the `db` service. `pg_stat_statements` counts since the server started or the last reset, so read the ratio of `mean_ms` to `max_ms` before the total. The first query is the twenty statements that have cost the most in total; the second is the paged read `listSessions` issues over `execution.session` (O20), the one to watch for a regression in the admin responses list.

```sql
SELECT calls,
       round(total_exec_time::numeric, 1) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       round(max_exec_time::numeric, 1) AS max_ms,
       rows,
       left(query, 240) AS statement
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY total_exec_time DESC
 LIMIT 20;
```

```sql
SELECT calls,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       round(max_exec_time::numeric, 1) AS max_ms,
       shared_blks_hit,
       shared_blks_read,
       left(query, 240) AS statement
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
   AND query LIKE '%"execution"."session"%order by%limit%'
 ORDER BY mean_exec_time DESC;
```

The second query matches `listSessions` by the table it reads and its `order by` and `limit`: one row per shape of the keyset segments (`db/reporting/keyset.ts`), so a filtered page and an unfiltered one are separate rows. A `mean_ms` that grows while `calls` does, or `shared_blks_read` that climbs, is the regression the `EXPLAIN` checks in `_tests/db/reporting/sessions.test.ts` are there to prevent, seen in production. A database test runs both queries as `qp_monitor` after a `listSessions` read and fails if the second finds nothing, so a rename of the table or a change to how the read is written cannot leave the documented query silently empty. To read a statement in a trace, find its trace id in the `traceparent` comment (layer 2) in `pg_stat_activity`.
