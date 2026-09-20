# @qp/telemetry

The only package that imports `pino` or OpenTelemetry (`@opentelemetry/*`, `@fastify/otel`). Every
log line, span and metric in the repo goes through it, so it is also where the one rule is enforced
([`docs/6-observability.md`](../../docs/6-observability.md) §3, decisions O1–O17).

## The rule

**Respondent answer values never enter telemetry.** Not in a log, a span attribute, a metric label
or an error message, at any level.

Three layers hold it here:

1. **Types.** A message must be a string literal and context is a closed set of registered fields
   whose types cannot carry free text. Answers are wrapped in `Sensitive<T>` (from `@qp/shared`),
   which is not any field's type.
2. **The scrub.** Anything unregistered, or registered with a value of the wrong shape, is dropped
   and counted rather than written. Span names and the logger's module name are checked against
   closed lists.
3. **Lint.** `eslint.config.mjs` rejects importing `pino` or OpenTelemetry anywhere else, and
   `local/no-cast-into-telemetry-text` is an error on a cast into a log message, a logger module name
   or a span name, which is the one channel the scrub cannot see (a message is written as given).

## Entry points

| Import | Use it for | Loads |
| --- | --- | --- |
| `@qp/telemetry` | `logger`, `withSpan`, `emitDomainEvent`, `watchPool`, the field registry and its types | `@opentelemetry/api` only; safe for a browser bundle |
| `@qp/telemetry/browser` | `createEventQueue`, `startBrowserTelemetry`, `installErrorCapture`, `injectTraceHeaders`, `afterFirstPaint`: the browser SDK | the core, `@opentelemetry/api`, `@opentelemetry/sdk-trace-web`; no Node built-in, `pino`, `./node`, `./testing` or `./leak-test` |
| `@qp/telemetry/node` | `startTelemetry`: starts the SDK, pino and the auto-instrumentation; `runningTelemetry`: the handle it returned, until that handle shuts down | the Node SDK, exporters, pino |
| `@qp/telemetry/testing` | `installTestTelemetry`: in-memory exporters for tests | the Node SDK |
| `@qp/telemetry/leak-test` | `LEAK_SENTINEL`, `runLeakFlow`, `expectCleanRun`, `exposuresOf`, `expectEmitted`, `plantThirdPartyTelemetry`, `plantThirdPartyCounter`: the sentinel leak test's detector, runner and assertions | the Node SDK |

Application code imports the first, and a browser app also the second. Only the backend's `src/telemetry.ts` (used by the preload and the entry point) imports
`./node`, and only tests import `./testing` and `./leak-test`.

`./testing` and `./leak-test` sit in the package's `src/` rather than under a `_tests/` directory because they are shared test
support. The leak test builds on the real pipeline that `./testing` installs, and every workspace's leak-test flows import it, so a
copy under `apps/backend/_tests` could not serve the others without deep imports into this package. Production code never
imports either: ESLint rejects `@qp/telemetry/testing` and `@qp/telemetry/leak-test` in every `src/` directory, and they are
separate entry points, so the browser-safe `.` entry never loads them.

## Browser

`@qp/telemetry/browser` is the browser half of decisions O5, O8, O11, O12, O17 and O19 ([`docs/6-observability.md`](../../docs/6-observability.md) §6). It knows nothing of the wire: the caller supplies `send` and `beacon`, so the `/telemetry` ingest and its envelope live with the app that calls it.

```ts
import { afterFirstPaint, injectTraceHeaders, startBrowserTelemetry } from "@qp/telemetry/browser";

afterFirstPaint(() => {
  startBrowserTelemetry({
    page: window,
    send: (events) => postBatch(events),
    beacon: (events) => navigator.sendBeacon(TELEMETRY_URL, toBlob(events)),
    screen: () => currentRouteTemplate(),
    debug: import.meta.env.DEV ? (record) => console.debug(record) : undefined,
  });
}, window);

fetch(url, { headers: injectTraceHeaders({ accept: "application/json" }) });
```

| Export | What it does |
| --- | --- |
| `createEventQueue({ send, beacon, screen?, maxPending?, batchSize?, flushIntervalMs? })` | A bounded queue of `{ level, message, attributes }` events. `enqueue({ level, message, attributes })` is the form for app code: the message is a literal (`LiteralMessage`, as in `logger`), the level is not `debug`, and the attributes cannot name `error.stack` or `module`, and a `module` an app passes anyway is discarded. `enqueueRecord` takes a plain record and is for `routeLogsToQueue` and `captureError`. Both scrub before they queue and never throw; `flush()` sends through `send`; `flushOnExit()` hands everything left to `beacon`; `close()` stops the timer and every later send, and ignores later events; `stats()` reports pending, sent and every drop |
| `routeLogsToQueue(queue, { debug? })` | Points `logger(...)` and `emitDomainEvent` at the queue. `debug` never reaches it: it goes to the optional `debug` function, which an app passes only in a development build |
| `flushOnPageHide(queue, window)` | `flushOnExit()` on `pagehide` and when `visibilitychange` finds the page hidden |
| `installErrorCapture(queue, window)`, `captureError(queue, kind, error)` | An `error` and an `unhandledrejection` listener, and the same capture for an error boundary. Records the error's class name and its stack frames only. Installing twice on one page adds no second listener |
| `startBrowserTracing()`, `stopBrowserTracing()`, `injectTraceHeaders(headers)` | A web tracer provider with a synchronous context manager, and the `traceparent` of the active span added to a headers record. With no active span the headers come back without any `traceparent`, so a stale one is never propagated. No `instrumentation-fetch` and no patching of global `fetch` (O12): the app's one `fetch` wrapper calls `injectTraceHeaders` by hand |
| `afterFirstPaint(start, window)` | Runs `start` in a `requestIdleCallback` after `load`, or a timeout after `load` where there is none; returns a cancel function |
| `startBrowserTelemetry({ page, ...queue options, debug? })` | Tracing, the queue, log routing, page-hide flush and error capture in one call; `stop()` undoes them, hands what is queued to `beacon` and closes the queue, so nothing is sent afterwards. A second call while one is running returns the running handle |

Rules the code holds:

- **The browser scrubs before anything is queued.** An event keeps only registry attributes, through the same `scrubAttributes(…, "log")` the pino formatter and exporters run. An unknown or ill-shaped field is dropped and counted in `stats().droppedFields`; the event stays (O17). A message that is not a lower-case literal shape (`^[a-z][a-z0-9 ._:-]{0,79}$`) is replaced by `unnamed`. That is a shape check: a lower-case token passes it, as it does the server's message.
- **A screen is a route template**, supplied by the caller and accepted only if the `route` field accepts it (O19). A URL, a query string, a cursor or free text is dropped.
- **An error is its class name and its frames, never its message.** `stackFramesOf` still decides whether the stack lines up with the message and keeps only frame-shaped lines; the queue then rewrites every frame of any `error.stack` it is given, from `captureError`, the logger or a caller alike. The location becomes the last path segment's script file name, `index-3f9a.js:10:20`, or `anonymous.js` for anything else, so no page URL, session id or query string survives. The function name is kept only if it is an identifier path (`Object.<anonymous>`, `async Promise.all`, `new Screen`, no interior underscore or space) of at most 100 characters and is otherwise `anonymous`. What counts as a safe frame is defined once, in `src/frame-shape.ts`, and the rewriter and the ingest's validator both use it: a file name past 80 characters becomes `anonymous.js`, a position past seven digits or a line past 200 characters becomes a fixed placeholder frame, and a stack is cut to 40 frames, so a stack the SDK produces is always one the ingest accepts. That is a shape check, so a one-word lower-case function name derived from an answer would pass; never build one from an answer. Stack frames in another browser's format (`fn@url:1:2`) do not line up, so those errors carry a type and no frames. The capture never reads an error event's `message`, `filename` or position.
- **The queue never blocks and never throws.** It holds at most `maxPending` events and drops the oldest, counting `overflow`; one `send` is in flight at a time; a batch whose `send` rejects or throws, or a beacon that returns `false`, is dropped and counted `undelivered`; anything the queue cannot handle is counted `internal`.
- **Never captured:** session replay, DOM or element text (a clicked option's label is an answer), URLs, query strings, cursors, request or response bodies.
- **Browser-safe by construction.** `_tests/browser.test.ts` reads the entry point's import graph and fails on a Node built-in, `pino`, `./node`, `./testing`, `./leak-test` or any package beyond `@opentelemetry/api`, `@opentelemetry/sdk-trace-web` and `@qp/shared`.
- **The page is injected.** No module reads `window`, `document` or `navigator`; the caller hands over `window` (a `PageWindow`) and its own `beacon`, so the tests run in the package's Node environment against fakes in `_tests/browser/page-fakes.ts`.
- **Limitation.** The context manager is synchronous: `injectTraceHeaders` sees the active span only when called before the first `await` inside `withSpan`. The apps' one `fetch` wrapper builds its headers before it awaits anything.

## Write a log line

```ts
import { logger } from "@qp/telemetry";

const log = logger("execution");

log.info("session submitted", { sessionId, questionnaireVersion: 2, outcome: "accepted" });
log.error("submit failed", { status: 500 }, error);
```

- `logger("<module>")` takes one of `LOG_MODULES` (`backend`, `browser`, `definition`, `events`, `execution`,
  `http`) and tags every line with it. A new module is one more member of that array. Methods are `debug`, `info`,
  `warn` and `error`. There is no `fatal`.
- The message must be a literal. `` `rejected ${value}` `` and a `string` variable are compile errors,
  and a cast that defeats the type (`value as "message"`, `as never`) is a lint error. Nothing checks
  a message at runtime, so this is the one field whose guard is the type and the lint rule alone. The
  rule is syntactic: it does not see a cast hoisted into a variable or through a type alias, a computed
  call, a logger held under another name, a wrapper, a namespace call, a logger created in another
  file or a cast in a later argument.
- Context is `{ ...fields }`. An unknown key is a compile error.
- The optional third argument is an `Error`. Only its class name and its stack frames are recorded,
  never its message, because a message can carry a value.
- A line below the configured level costs one comparison and is never built.

## The field registry

`FIELDS` in `src/fields.ts` is the closed list of things telemetry can say. Each entry pairs a
context key with an attribute name, a runtime check and a `bounded` flag.

| Key | Attribute | Accepts | Bounded |
| --- | --- | --- | --- |
| `sessionId`, `questionnaireId`, `questionnaireVersionId`, `questionId`, `requestId` | `questionnaire.session_id`, `questionnaire.id`, … | a UUID (`UUID_PATTERN` from `@qp/shared`) | no |
| `itemId`, `lastItemId` | `questionnaire.item_id`, `questionnaire.last_item_id` | an author-chosen slug (`SLUG_PATTERN` from `@qp/shared`) | no |
| `questionnaireVersion`, `elapsedSeconds`, `durationMs`, `questionCount`, `responseTimeMs` | `questionnaire.version`, … | a finite number | no |
| `findingCount`, `omittedCount`, `codeFindingCount` | `questionnaire.finding_count`, `questionnaire.omitted_count`, `questionnaire.code_finding_count` | a whole number from 0 to 1,000,000 (`COUNT_FIELDS`): a refused request's real number of findings, how many were not logged one by one, and how many carried one code | no |
| `questionType`, `outcome`, `reason`, `method`, `signal` | `questionnaire.question_type`, … | a member of a closed list | yes |
| `status` | `http.response.status_code` | an integer from 100 to 599 | yes |
| `route` | `http.route` | a route template: `/`, or lower-case literal segments and `:name`, `$name`, `{name}` or `*` parameters, with no query string or fragment | yes |
| `errorType` | `error.type` | a class name: a capital letter, then letters and digits (a raw `pg` `DatabaseError`, named `error`, has none) | yes |
| `errorCode` | `error.code` | a five-character SQLSTATE (`23505`, `QP001`) | yes |
| `invariant` | `error.invariant` | a dotted lower-case name with at least one dot (`session.not-marked-submitted`) | yes |
| `constraint` | `db.constraint` | a lower-case snake-case Postgres constraint name with at least one underscore | yes |
| `problem`, `problemCode` | `problem.slug`, `problem.code` | a problem slug; a question rule, draft item, submission item or known schema code | yes |
| `pool` | `db.pool` | `definition`, `execution` or `reporting` | yes |
| `source` | `telemetry.source` | `browser`; the ingest stamps it on what a browser sent, a server-native line carries none, and a browser cannot set it | yes |
| `eventAgeMs` | `telemetry.event_age_ms` | a finite number; the ingest stamps the time between an event's own timestamp and its receipt, and a browser cannot set it | no |
| `errorStack` | `error.stack` | stack frames only; set from the `Error` argument, not by callers | no |

An id field takes a UUID or a slug, not "any token", because a one-word answer, a hyphenated phrase
or a date passes a token check. A slug-shaped answer in `itemId` and a lower-case word as a route
segment still pass; the item id and the route come from the author's definition and the route table,
never from a respondent. `apps/backend/_tests/invariant.test.ts` checks every invariant name written
in the backend against the `invariant` shape, since telemetry cannot import the backend.

**Bounded** means safe as a metric label. Identifiers are not: each distinct value would be a new
time series ([`docs/6-observability.md`](../../docs/6-observability.md) §7).

Adding a field is a one-line entry in `FIELDS`, and a reviewer sees it.

## The scrub

`src/scrub.ts` has two functions, and both return the kept attributes plus a count of what they
dropped.

| Function | Input keys | Used by |
| --- | --- | --- |
| `scrubContext(context)` | context keys (`sessionId`) | `logger`, `withSpan`, domain-event counters |
| `scrubAttributes(attributes, kind)` | attribute names (`questionnaire.session_id`) | the pino formatter and the exporters |

A value is dropped for one of four reasons, in `DROP_REASONS`:

| Reason | Meaning |
| --- | --- |
| `unknown` | The key is not in the registry or the infrastructure allowlist |
| `invalid` | The key is known but the value fails its check: free text, wrong type, an object, a `Sensitive` |
| `unbounded` | A metric carried an attribute that is not bounded |
| `internal` | Telemetry itself failed: a scrub met an input it could not read, a sink, instrument or span call threw, or an exporter could not scrub a batch. Nothing partial is emitted. It counts calls, one per failure, where the other three reasons count fields |

Drops are counted in the `telemetry.scrub.dropped` counter, labelled by signal (`log`, `span`,
`metric`) and reason, and never by key.

Infrastructure attributes are a small allowlist of safe OpenTelemetry names an instrumentation
attaches on its own (`db.system`, `server.port`, `fastify.type`, …). `url.path`, `url.full`,
`db.statement`, `db.query.text`, request bodies and exception messages are deliberately absent.
`db.query.text` is the one attribute dropped from a span without a count, because every `pg` query
span carries it and a count would put a constant floor under `telemetry.scrub.dropped`; it is still
counted `unknown` on a log line or a metric.

### Where it runs

| When | Where | What is scrubbed |
| --- | --- | --- |
| Call time | `logger.ts`, `spans.ts`, `instruments.ts` | The caller's context, through `scrubContext` |
| Log output | the pino `formatters.log` hook in `pipeline.ts` | The final object, through `scrubAttributes(…, "log")` |
| Export time | `exporters.ts` | Every span's name, attributes, events and links, and every metric data point, before they reach OTLP; and which metrics an instrumentation may export at all (see "Database and runtime telemetry") |

The export-time layer is the one that catches what the types cannot see: a third-party
instrumentation attaching a request body, or an exception event carrying a message.

It scrubs span names, span and event and link attributes, span status and metric data-point
attributes. It does **not** scrub a span event's name, a metric's name, description or unit, the
instrumentation scope's name and version, or the resource attributes: they reach export as written.
They are code constants in this repo and in the instrumentations, so no answer reaches them today, but
nothing checks them. A change that lets a variable reach any of them needs a runtime check first.
The known holes are listed in `.claude/skills/telemetry-safety/SKILL.md`.

## Telemetry never throws

Nothing exported from `@qp/telemetry` or `@qp/telemetry/node` that application code calls after a
business action may fail that action. `logger(...).debug/info/warn/error`, `emitDomainEvent`,
`problemTelemetry`, `annotateActiveSpan`, `activeTraceId`, `scrubContext` and `scrubAttributes` return
normally whatever their sink, instrument or input does: a sink that throws, a `getMeter` or an
instrument that throws, and a context with a throwing getter, `Proxy` or `toString`. `withSpan` returns the
callback's value and rethrows the callback's own error, and never throws or hangs because the SDK or a
scrub failed; the callback runs exactly once, with or without a span. On a failure nothing partial is
emitted: a log line whose scrub or sink failed is not written, a scrub of a hostile input returns no
attributes, and a span whose context could not be scrubbed exports with no attributes. The failure is
counted in `telemetry.scrub.dropped` with reason `internal` and the signal it belonged to. A telemetry
failure's own error is discarded, so its message cannot reach a signal. If the meter itself is what
failed, the count cannot be made and nothing is recorded. When `problemTelemetry` fails it returns
`[]`, so the "problem response" line for that request is not written and only the counter records the
failure. `guarded` in `guard.ts` is the shared wrapper; `scrub.ts` and `instruments.ts` carry their own
`try`/`catch` because `guard.ts` imports `instruments.ts`. The export decorators in `exporters.ts` fail
a batch they cannot scrub and call the exporter's callback with a failed result. Startup
(`startTelemetry`) and the handle's `flush` and `shutdown` are lifecycle calls, not business-path
calls, and still reject on failure. A drop the pino formatter and a domain event's counter labels
find is counted too, through `reportDropped`.

## Spans

```ts
await withSpan("session.submit", { sessionId }, async () => submit());
```

- `SpanName` is derived from `SPAN_NAMES` (`questionnaire.create`, `questionnaire.edit_draft`, `questionnaire.open_draft`, `questionnaire.publish`,
  `questionnaire.retire`, `reporting.list_sessions`, `reporting.session_detail`, `rule.evaluate`, `session.submit`,
  `telemetry.ingest`); a new span is one more member of that array.
  The backend wraps a submit in `session.submit` and its answer evaluation in `rule.evaluate`, each questionnaire lifecycle
  write in its `questionnaire.*` span and each reporting read in a `reporting.*` span; the outcome, and the version for a publish, are added once known.
- A name outside `SPAN_NAMES`, which only a cast or an untyped caller can pass, does not throw: `withSpan`
  runs the callback with no span and counts one `span/unknown` drop.
- Context becomes attributes through the registry, so it is scrubbed like a log line.
- On a throw the span is marked `ERROR` with `error.type` only, no status message, and the error is
  rethrown. A failure of the SDK itself is swallowed and counted, never thrown; see "Telemetry never throws".
- Logs written inside the callback carry its `trace_id` and `span_id`.

The exporter applies the same list to every span it sees. A declared name and an explicit allowlist of
the names the instrumentations produce pass: `request`; `<hook> - <name>` for a Fastify lifecycle
hook, `handler` or `notFoundHandler`, where the name is a camel-case identifier (including
`anonymous`) or the plugin fallback `fastify -> @fastify/otel`; `pg.query`, `pg.query:<verb>` for a
closed list of SQL verbs, `pg.connect` and `pg-pool.connect`. The database slot of
`pg.query:<verb> <db>` is dropped from the exported name. Any other name is exported as `unnamed`, and
the span, its parent link and its scrubbed attributes are kept, so the trace stays whole. That costs one
`span/unknown` drop per such span, which is how a new instrumentation shows up. Name route handlers and
hook functions: an anonymous one is named after its plugin. A one-word lower-case camel-case name in the
`<name>` slot (`handler - diabetes`) still passes; see the skill's hole 4.

## Problem outcomes

```ts
for (const fields of problemTelemetry(body)) log.info("problem response", { ...request, ...fields });
```

`problemTelemetry(problem)` projects a problem body into registry fields: its slug, its status and, for
a problem that carries `items` or `errors`, one entry per finding with its code and, for items, its
item id. It never reads `title`, `detail`, `instance`, a pointer or any other member, and it caps a
problem at 20 entries. A schema code outside the known list (`SCHEMA_CODES`) becomes `schema/other`, so
the wire contract stays open and the code stays safe as a metric label
([`docs/6-observability.md`](../../docs/6-observability.md) O8, L3).

`activeTraceId()` returns the trace id of the active span, and `annotateActiveSpan(context, error?)`
adds scrubbed fields, and the error's class name, to it.

## Domain events

```ts
emitDomainEvent({ name: "session.question_answered", sessionId, itemId, questionId, questionType: "date" });
```

One call writes an `info` log line named for the event and, for an event that has a counter, increments it, so the two
cannot drift. An event defined `logOnly` writes its line and has no counter. `DomainEvent` is a closed union whose fields
are all registry fields.

Each event is defined once, in the `DOMAIN_EVENTS` table in `src/events.ts`: its name, its payload
type and its counter name (or `logOnly`) on one entry. `DomainEvent` and the counter lookup are derived from that
table, so adding an event is one entry.

```ts
"session.answers_rejected": event<{ sessionId: string; reason: SubmissionItemCode; codeFindingCount: number }>(
  "questionnaire.answers.rejected",
  { labels: ["reason"], countBy: "codeFindingCount" },
),
```

`countBy` names one of the `COUNT_FIELDS` (`findingCount`, `omittedCount`, `codeFindingCount`, the registry's whole-number
count fields) that the event's payload carries as a number, and the counter adds that field's value instead of 1. A value that
is not a whole number from 0 to 1,000,000 (a fraction, a negative, `-0`, a `BigInt`, text, an object, a missing one) adds
nothing and is counted as one internal metric drop (`telemetry.scrub.dropped`, reason `internal`); it never throws.

A request that fails many items emits its per-item lines up to `MAX_FINDINGS` (20, in `src/problems.ts`) and no more.
Those per-item events (`session.answer_rejected`, `questionnaire.publish_rejected`) are `logOnly`, so they never touch a
counter. The counter is driven by one event per distinct code (`session.answers_rejected`,
`questionnaire.publish_items_rejected`) whose `codeFindingCount` is the real number of findings with that code, so the counter's
total equals the number of findings and nothing counts twice. `capFindings(findings, codeOf)` derives all of it from one
place: the findings to log (the first `MAX_FINDINGS`), the per-code tallies and the request totals. The totals are `findingCount`
(every finding) and `omittedCount` (findings past the cap, 0 when there are `MAX_FINDINGS` or fewer), and
`session.submit_finished` and `questionnaire.publish_finished` add them to their log line when the outcome is
`rejected_validation`. `codeFindingCount` is one code's share and `findingCount` is the request's total, so a query never
sums one across the other. All three are numbers on the log line and never metric labels, and none may come from a browser.

| Event | Counter |
| --- | --- |
| `questionnaire.created`, `.published`, `.retired` | `questionnaire.created`, `.published`, `.retired`; `retired` means a close time was set or moved, not a version retired |
| `questionnaire.publish_finished` | `questionnaire.publish.total`, labelled by `outcome`; `findingCount` and `omittedCount` ride on the line for a validation refusal |
| `questionnaire.publish_rejected` | none: a log line per refused item, at most `MAX_FINDINGS` per publish |
| `questionnaire.publish_items_rejected` | `questionnaire.publish.rejections`, labelled by `problemCode`, a draft item code, adding `codeFindingCount` (one event per distinct code) |
| `questionnaire.draft_conflict` | `questionnaire.draft.conflicts` |
| `reporting.responses_listed`, `reporting.response_viewed` | `questionnaire.responses.listed`, `questionnaire.responses.viewed` |
| `session.started`, `.resumed`, `.abandoned`, `.completed` | `questionnaire.sessions.started`, `.resumed`, `.abandoned`, `.completed` |
| `session.question_answered` | `questionnaire.answers.accepted`, labelled by `questionType` |
| `session.answer_rejected` | none: a log line per rejection, at most `MAX_FINDINGS` per submit; `itemId` and `questionId` are `null` for an unknown item key, which came from the respondent |
| `session.answers_rejected` | `questionnaire.answers.rejected`, labelled by `reason`, adding `codeFindingCount` (one event per distinct reason) |
| `session.item_skipped` | `questionnaire.items.skipped` |
| `session.rejected_past_cutoff` | `questionnaire.sessions.rejected_past_cutoff` |
| `session.submit_finished` | `questionnaire.submissions`, labelled by `outcome` (`accepted`, `replayed`, `rejected_validation`, `rejected_conflict`, `failed`); `questionnaireId` and `questionnaireVersion` are `null` for `failed`, which is known only by the session id; `findingCount` and `omittedCount` ride on the line for a validation refusal |

`session.completed` also records `questionnaire.session.duration`, a histogram in milliseconds with explicit bucket boundaries from one second to a day.
Counters carry bounded labels only, named per event in its `labels`. The ingest stamps `source: "browser"` on the ones a browser
sends; `emitDomainEvent` stamps nothing, since the browser SDK routes it into its own queue too.

## The ingest

`ingestBatch(events, receivedAt)` is what `POST /api/telemetry` runs
([`docs/6-observability.md`](../../docs/6-observability.md) O5, O17, L4). The backend plugin owns the wire contract, the rate
limit and the body cap; this function owns what is kept. It takes each event as `unknown` and never rejects a batch:

1. An event that is not an object, or has no string `name`, no parseable `at` timestamp or `fields` that are not an object, is dropped
   as `malformed`.
2. A name outside the allowlist is dropped as `unknown_event`. The allowlist is the client log events (`client.info`, `client.warn`,
   `client.error`: `client.` and one of `CLIENT_LOG_LEVELS`, the levels O8 lets a browser send) plus `BROWSER_DOMAIN_EVENTS` (`wire-contract.ts`), which is
   `session.abandoned` alone. The events the server emits, `session.item_skipped` among them (O11), are not on it, so a browser
   cannot move `questionnaire.published` or the session-duration histogram. A client log line carries no message: its level is
   its name and its meaning is its fields.
3. Each event has its own closed list of browser-eligible fields (the `BROWSER_FIELDS` table in `wire-contract.ts`, typed against `FieldName` and read through `browserFieldsOf` and `judgeBrowserField`, which the SDK's wire mapping uses too): the
   ids and counts a browser knows, `errorType`, `errorStack`, `route` and `method`. A field is kept only if it is on its event's
   list and its value passes the field's check. Everything else, the server-owned fields (`constraint`, `invariant`, `errorCode`,
   `requestId`, `problem`, `pool`, `signal`, `status`, `source`, `eventAgeMs` and the rest), is dropped, counted as
   `unknown_field` or `invalid_field`, and the rest of the event is kept. `errorStack` is held to a stricter shape than the
   registry's own (`fields.ts` keeps its lax `STACK_FRAME`, the shape of a stack the server captures from its own errors, where a frame's
   location is an absolute path or a URL, and `frame-shape.ts` is the strict shape of a stack that arrives from a browser, where a
   location is a bare script file. They differ because the two are captured differently: tightening the server's shape would refuse every
   server stack, and loosening the browser's would admit any path a client chose to send): every line must be a frame with an identifier-path function name and a bare script file with line and column, or
   an `<anonymous>` or `native` marker (`BROWSER_STACK_FRAME` and `isBrowserStack` in `frame-shape.ts`, at most 40 lines of 200
   characters, function names of at most 100). The browser SDK's `frames.ts` builds what it emits from the same definition, so the
   two cannot drift. The file-name slot still accepts any `name.js` of up to 80 characters, since hashed bundle names contain
   underscores.
4. An optional `traceparent` (`00-<32 hex>-<16 hex>-<2 hex>`, parsed by `parseTraceparent` in `trace-context.ts`, beside the `formatTraceparent` the SDK writes it with) puts the event's log line under the browser's trace and span. An
   invalid one is dropped as `invalid_trace`. Without one, the line takes the trace of the request that carried it.
5. The event is re-emitted with `source: "browser"` and `eventAgeMs`, through `relayLog` for a client log line (module `browser`)
   or `relayBrowserEvent` for a domain event, which write the same log line and counter as `emitDomainEvent`, then pass the scrub
   at call time and again at export.
6. Events past `MAX_TELEMETRY_EVENTS` are dropped as `over_limit`.

The ingest never throws into the handler. `ingestBatch` guards each event with `guardedOr`, and `relayLog`, `relayBrowserEvent` and
`reportIngestDropped` swallow and count their own failures as `internal` drops of `telemetry.scrub.dropped`. A failing sink, meter or hostile
value drops that event, which is counted in the receipt's `dropped` and never half-emitted, and the batch still answers `202`. An event is
accepted once its log line is written; a counter that fails after that is an `internal` metric drop, not a dropped event.

Every drop is one increment of `telemetry.ingest.dropped`, labelled `telemetry.ingest_reason` with a member of
`INGEST_DROP_REASONS` (`malformed`, `unknown_event`, `unknown_field`, `invalid_field`, `invalid_trace`, `over_limit`). Field drops
are not event drops: the receipt's `dropped` counts events only. An event's name, timestamp, traceparent and rejected values are
counted and never logged.

A new browser event is one more `BROWSER_DOMAIN_EVENTS` member, with its fields typed against that event's payload in `DOMAIN_EVENTS` (so the
list cannot name a field `emitDomainEvent` does not carry), or one more level in `CLIENT_LOG_LEVELS`, all in `vocabulary.ts` and `wire-contract.ts`. A new field is one `FIELDS` entry, and one entry in the event's list if a browser may
send it. Both go expand-then-contract (O17): the server accepts a name or field before any
build sends it and stops accepting it only after no deployed build does.

The plugin around it (`apps/backend/src/modules/telemetry`) answers a batch that is not an envelope, is not JSON or carries a
`__proto__` or `constructor.prototype` key anywhere as a `400` `request/invalid` problem for the whole batch, since Fastify refuses
the body before the ingest sees it. A body over 64 KiB is a `413` that the error handler answers as `request/invalid`. The
per-address rate limit (300 a minute, one bucket per IPv4 address or IPv6 `/64`) is keyed on `request.ip`, and `buildApp` sets
`trustProxy: 1` for the one nginx hop, so each browser has its own bucket ([`docs/6-observability.md`](../../docs/6-observability.md)
O21). The browser must cap its batch bytes below the limit and send a beacon as a `Blob` typed `application/json`, because a plain
string goes as `text/plain`, which is a `400`.

## Sending to the ingest

`src/browser/wire.ts` turns what the queue holds into what `POST /api/telemetry` reads, so the SDK and the ingest agree by construction
and by test. It is the one home of that mapping; `_tests/browser/wire-contract.leak-test.test.ts` builds events with the real queue,
`captureError` and `emitDomainEvent`, maps them with it and feeds them to the real `ingestBatch`, and fails on any event dropped or any
`unknown_field`, `invalid_field`, `unknown_event`, `malformed` or `invalid_trace` count.

- `toWireEvent(queuedEvent)` renames each attribute key to its registry field name through `FIELDS` (there is no second name table) and
  drops every attribute with no registry entry and every field `keepsFromBrowser` refuses, the same gate the ingest applies through
  `judgeBrowserField`: the field must be on the event's own list and its value must pass the field's check. A field the ingest would
  count as dropped is never sent. A client log line's message is not sent: its level is its name, `clientLogEventOf(level)`.
- A queued event is a browser domain event, and is named `session.abandoned`, only if the queue marked it, and only a record that
  `emitDomainEvent` wrote can be marked. `logger.ts` keeps a `WeakSet` of the records `logDomainEvent` builds, which is what
  `emitDomainEvent` calls and nothing else does, and `isDomainEventRecord` reads it; `scrubbedEvent` sets the `event` marker only for
  such a record whose message is a `BROWSER_DOMAIN_EVENTS` member. The `module` attribute is never trusted: `logger("events")` from
  app code, a caller's `module: "events"` and a message that spells `session.abandoned` all stay client log lines. `enqueue`, the
  app-facing form, also discards a caller's `module` attribute, and `CallerAttributes` types it as `never`. `nameOf` checks the marker
  against `BROWSER_DOMAIN_EVENTS` again, so a marker that is not on the list is ignored.
- `at` is stamped when the event is queued, from the queue's `now` option (`Date.now` by default), so the server's `eventAgeMs` is the
  age of the event and not of its batch. It is the client's clock: a clock that runs behind gives an age that is too large, and one
  that runs ahead reads as 0, since the server never stamps a negative age. The age is a log field only and drives no counter or alert.
  `traceparent` is the active span's, formatted by `formatTraceparent`, and is absent when no valid span is active.
- `toEnvelopes(events, maxBytes?)` returns `{ events }` envelopes of at most `MAX_TELEMETRY_EVENTS` events and `maxBytes` bytes of UTF-8 JSON
  (`MAX_TELEMETRY_BODY_BYTES` from `@qp/shared` by default), splitting into several when a batch is larger. `session.abandoned` events come
  first. A beacon passes `BEACON_BODY_BUDGET_BYTES` (half of `MAX_TELEMETRY_BODY_BYTES`, 32 KiB) so that one envelope never uses the whole of `sendBeacon`'s roughly 64 KiB
  quota. `flushOnExit` orders the whole pending queue with the abandonments first before it slices it into batches, so an abandonment
  is in the first batch handed to the beacon and, mapped with the budget, in the first envelope. No single event can outgrow an
  envelope: a stack is at most 40 frames of 200 characters, and every other field is short.
- `toBeaconBlob(envelope)` is a `Blob` typed `application/json`, for `navigator.sendBeacon`; `toFetchInit(envelope)` is a `POST` with
  `content-type: application/json`, for the app's one `fetch` call. Both send the same bytes.

`trace-context.ts` has no imports and holds the `traceparent` version and field widths, `formatTraceparent` and `parseTraceparent`, so
the header the SDK writes and the field the ingest reads cannot drift; `_tests/trace-context.test.ts` round-trips one through the other.
`injectTraceHeaders`, `startBrowserTracing` and `stopBrowserTracing` run under `guarded`, `guardedOr` and `guardedAsync` (the two global disables each under their own guard), and a
`startBrowserTracing` that fails to register its context manager unregisters the tracer provider it had registered.

## Sinks

`logger.ts` does not write anything. It builds a scrubbed record, `{ level, message, attributes }`,
and hands it to the **sink**, a `(record) => void` set by `configureLogging`.

| State | Behaviour |
| --- | --- |
| No sink set | Every log call is a no-op. This is the state before `startTelemetry` runs and after `shutdown` |
| Sink set | The record is passed to it if the level is at or above the threshold |

The real sink is pino, created in `pipeline.ts`: JSON to stdout, or `pino-pretty` when
`prettyLogs` is set. Tests use the same sink writing into memory.

## Startup

`startTelemetry(options)` from `@qp/telemetry/node` does the following, in order:

1. Resets the global OpenTelemetry registrations and the instrument cache.
2. Points the logger at the pino sink.
3. If `autoInstrumentation` is on, registers the ESM loader hook.
4. Builds a `NodeSDK` with `FastifyOtelInstrumentation`, the database instrumentation and `RuntimeNodeInstrumentation` when `autoInstrumentation` is on.
5. Starts the connection-pool gauges.

| Option | Effect |
| --- | --- |
| `otlpEndpoint` set | Traces go to `<endpoint>/v1/traces` and metrics to `<endpoint>/v1/metrics`, each through the scrub |
| `otlpEndpoint` unset or empty | Nothing is exported. Spans are still recorded, so logs carry trace ids |
| `autoInstrumentation: false` | No loader hook and no instrumentations; for tests |

`installTestTelemetry({ autoInstrumentation: true })` starts the same three instrumentations without the loader hook, which is enough for Fastify to be traced under test and lets the export-time scrub see real instrumentation output. It does not patch `pg`: the driver is imported before the instrumentation starts, so a test that needs query spans passes the driver it already loaded, `installTestTelemetry({ autoInstrumentation: true, loadedDatabaseDriver: pg })`.

The SDK has no logs signal: logs leave through pino only.

### The `--import` preload

Instrumentation must start before the code it patches loads, so the backend starts through a
preload:

```
node --import ./dist/instrumentation.js dist/index.js
```

`apps/backend/src/instrumentation.ts` calls `startBackendTelemetry` in `src/telemetry.ts`, which reads `config.ts` (the
only place `process.env` is read) and calls `startTelemetry`. `npm start`, `npm run dev` and the backend `Dockerfile` all use it. A process
started without it has no auto-instrumentation: `src/index.ts` finds no `runningTelemetry()`, starts telemetry itself so
logs and manual spans still work, and logs a warning.

## Database and runtime telemetry

**Query spans and the SQL comment.** `DatabaseInstrumentation` (`src/database-instrumentation.ts`) is `@opentelemetry/instrumentation-pg`
with `DATABASE_INSTRUMENTATION_CONFIG`: `addSqlCommenterCommentToQueries` on, so each statement leaves the process with a trailing
comment `/*traceparent='00-<trace id>-<span id>-01'*/` naming its own span, and `enhancedDatabaseReporting` off, so bound
parameters are never put on a span. Postgres shows the comment in `pg_stat_activity` and its log, and drops it when it
normalises a statement, so `pg_stat_statements` does not split one statement by trace. A span exports only `db.system.name`,
`db.namespace`, `server.address` and `server.port`; `db.query.text` is never exported and an error's message never reaches the span.

**`patchLoaded`.** The instrumentation hooks a module when it is first `require`d, which never happens under test for a driver an earlier
import already loaded, and only once per process. `patchLoaded(driver)` applies the instrumentation's own patch functions to the
`Client` and `Pool` the caller hands over, and `disable()` (which the pipeline calls at shutdown) undoes it, so every flow gets a
fresh patch against the driver the app under test uses. The pipeline only does this when `loadedDatabaseDriver` is given, and only
tests give it; production keeps the module hooks and the `--import` preload.

**Pool gauges.** `watchPool(pool, counts)` registers a pool under one of the bounded `pool` field's values (`definition`,
`execution`, `reporting`) and returns a function that stops watching it. `openDatabase` calls it with `pool.totalCount`,
`idleCount` and `waitingCount` when it is given a `pool`, and sets `application_name` to `qp-backend:<pool>`. The pipeline creates
three observable gauges that read the registered pools when metrics are collected, whether the pool was opened before or after
telemetry started:

| Metric | Label | Reads |
| --- | --- | --- |
| `db.pool.connections.total` | `db.pool` | connections the pool holds, idle or in use |
| `db.pool.connections.idle` | `db.pool` | connections not in use |
| `db.pool.connections.waiting` | `db.pool` | requests queued for a connection |

`@opentelemetry/instrumentation-pg`'s own pool metrics carry the pool's host, port and database, which are the same for all three pools,
so they cannot tell them apart.

**Event-loop lag.** `RuntimeNodeInstrumentation` exports `nodejs.eventloop.delay.{min,max,mean,stddev,p50,p90,p99}` (seconds) and
`nodejs.eventloop.utilization`, none with a label. The delay gauges report nothing until the loop has been sampled five times.

**Which instrument metrics leave the process.** `ambient-metrics.ts` lists them. The exporter keeps only `db.client.operation.duration`
from the `pg` scope and only the event-loop metrics from the runtime scope; `db.client.connection.count` and
`db.client.connection.pending_requests` (labelled by pool name and state) and the runtime's GC, heap-space, resource and event-loop-time
metrics carry labels that are not on the allowlist, so they are dropped whole rather than exported with their labels stripped. A scope
that is not listed passes unchanged, its labels scrubbed as always. `db.client.operation.duration` keeps `db.operation.name`,
`db.namespace`, `server.address` and `server.port`; an `error.type` that is a SQLSTATE such as `22P02` is not a class name, so that label is
dropped and counted `invalid`.

The pool gauges and the event-loop metrics exist because the process is running, not because a request did anything, so the leak test
does not count them as a flow's own telemetry (`isAmbientMetric`): a flow that emits nothing still fails as vacuous.

## Testing

```ts
import { installTestTelemetry } from "@qp/telemetry/testing";

const telemetry = installTestTelemetry();
logger("execution").info("hello", { sessionId: "s-1" });
telemetry.logs();
telemetry.spans();
await telemetry.metrics();
await telemetry.shutdown();
```

| Method | Returns |
| --- | --- |
| `logs()` | Parsed JSON log lines, as pino wrote them |
| `spans()` | Finished spans, after the scrub |
| `metrics()` | The latest metric data, after a flush and the scrub |
| `reset()` | Clears all three |
| `shutdown()` | Tears the pipeline down; call it in `afterEach` |

It runs the real pipeline with in-memory exporters, so a test sees what an exporter would receive.

## The leak test

`@qp/telemetry/leak-test` is the detector and runner behind the sentinel leak test
([`docs/8-testing.md`](../../docs/8-testing.md) §2.5). A flow plants `LEAK_SENTINEL` where an answer
value would be and runs one code path; the runner then reports every span, metric data point and log
line that carries it.

```ts
import { LEAK_SENTINEL, runLeakFlow, type LeakFlow } from "@qp/telemetry/leak-test";

const flow: LeakFlow<World> = { name: "…", run: async (world, sentinel) => { … } };
const { exposures, observed } = await runLeakFlow(flow, world);
```

| Export | Returns |
| --- | --- |
| `runLeakFlow(flow, world, options?)` | Installs test telemetry (`options.autoInstrumentation` turns on the Fastify, database and runtime instrumentations; `options.loadedDatabaseDriver` patches the `pg` the app already loaded), runs the flow, and returns `exposures` (signal and name of each leak), `observed` (how many logs, spans and metrics the flow emitted, not counting `telemetry.scrub.dropped` or the ambient pool and event-loop metrics), `internalDrops` (how many telemetry calls failed and were swallowed), `spanNames` (the exported span names) and `metricNames` (the exported metric names). Fastify's instrumentation only patches an app created after it starts, so a flow that needs real spans builds its app inside `run`. It shuts the pipeline down even when the flow throws |
| `expectCleanRun(name, run, sentinel?, options?)` | Throws a plain `Error` if the run has an exposure, if the flow emitted nothing, or if a telemetry call in it failed and was swallowed (`run.internalDrops` above zero, reason `internal`); `options.allowInternalDrops` opts a flow that forces such a failure on purpose out of the last check. The `telemetry.scrub.dropped` counter is not counted as the flow's own telemetry |
| `expectEmitted(name, run, messages)` | Throws a plain `Error` if the run did not write a log line for each of these messages (`run.logMessages`), so a flow that declares `emits` fails as vacuous when the code it was written for did not run |
| `plantThirdPartyTelemetry(sentinel)` | Emits spans, one named for the sentinel, and a counter carrying the sentinel the way a third-party instrumentation would, to exercise the export-time scrub |
| `plantThirdPartyCounter(labels)` | Emits a counter with exactly these labels, so a negative control can put a shaped value on a bounded metric label |
| `exposuresOf(telemetry)` | Every log line, span and metric whose serialised form contains the sentinel, keys included, in any case |

`pg` spans appear under test when the flow's world hands the loaded driver to `runLeakFlow` (the backend's `runOnLeakApp` does), so a
sentinel bound as a SQL parameter, or echoed in a driver error message, is checked against the query spans, their attributes and the
`db.client.operation.duration` labels.

The flows live with the code they exercise. The backend's registry is
`apps/backend/_tests/leak-test/flows.ts`; `npm run test:leak-test` runs it and CI gates on it.

## Layout

| File | Contents |
| --- | --- |
| `src/index.ts` | The core entry point's exports |
| `src/browser.ts`, `src/browser/` | The browser entry point and its parts: `queue.ts`, `events.ts` (the queued event and its scrub), `errors.ts`, `frames.ts` (the stack-frame rewrite), `lifecycle.ts`, `logging.ts`, `idle.ts`, `tracing.ts`, `wire.ts` (the queue's events as ingest envelopes, and their encodings), `start.ts`, `page.ts` (the structural types for `window`) |
| `src/fields.ts` | `FIELDS`, `TelemetryContext`, the infrastructure allowlist, `OUTCOMES` |
| `src/vocabulary.ts` | Constants shared by more than one module: the instrumentation scope, signal kinds, drop reasons, log modules and the attribute names the pipeline writes about itself |
| `src/scrub.ts` | `scrubContext`, `scrubAttributes` |
| `src/ambient-metrics.ts` | `POOL_METRICS`, which instrument metrics an instrumentation may export (`isExportedInstrument`) and which metrics exist because the process runs (`isAmbientMetric`) |
| `src/database-instrumentation.ts` | `DatabaseInstrumentation`, `DATABASE_INSTRUMENTATION_CONFIG`, `LoadedDatabaseDriver` |
| `src/pool-metrics.ts` | `watchPool`, `startPoolGauges` (pipeline only), `PoolCounts`, `PoolName` |
| `src/guard.ts` | `guarded`, `guardedOr`, `guardedAsync`: run a telemetry action, swallow a failure and count it as `internal` |
| `src/logger.ts` | `logger`, `LOG_LEVELS`, `LiteralMessage`, the sink and threshold, and `logDomainEvent` with `isDomainEventRecord`, which mark the records `emitDomainEvent` writes |
| `src/spans.ts` | `withSpan`, `SPAN_NAMES`, `SpanName`, `activeTraceId`, `annotateActiveSpan` |
| `src/problems.ts` | `projectProblem`, `PROBLEM_CODES`, `SCHEMA_CODES`, `MAX_FINDINGS`, `capFindings` |
| `src/problem-telemetry.ts` | `problemTelemetry`: `projectProblem` behind the never-throw guard |
| `src/events.ts` | `DOMAIN_EVENTS` (each event's name, payload, counter and counter labels), `DomainEvent`, `emitDomainEvent`, `relayBrowserEvent` |
| `src/ingest.ts` | `ingestBatch`: the `/api/telemetry` ingest's event allowlist, field filter, trace context and drop counting, behind the never-throw guard |
| `src/wire-contract.ts` | What a browser may send: `BROWSER_DOMAIN_EVENTS`, the closed field list of each event behind `browserFieldsOf`, `browserDomainEventOf`, `judgeBrowserField` and `keepsFromBrowser`. The ingest reads it and `browser/wire.ts` writes to it. Imports no Node module, so the browser entry can use it |
| `src/trace-context.ts` | `formatTraceparent`, `parseTraceparent` and the `traceparent` field widths. No imports |
| `src/frame-shape.ts` | The one definition of a safe stack frame: its pattern pieces, caps, placeholders, `isSafeFunctionName`, `isSafeScriptFile`, `isSafePosition`, `BROWSER_STACK_FRAME` and `isBrowserStack`. No imports, so the browser entry can use it |
| `src/instruments.ts` | The counter and histogram primitives, the session-duration histogram, the scrub drop counter and the ingest drop counter; each swallows and counts its own failure |
| `src/exporters.ts` | The scrubbing decorators for span and metric exporters |
| `src/pipeline.ts` | Builds the SDK, the pino sink and the exporters |
| `src/node.ts` | `startTelemetry`, `runningTelemetry` |
| `src/testing.ts` | `installTestTelemetry` (its `internalDrops()` reads the swallowed-failure count), `internalDropCount` |
| `src/leak-test.ts` | `LEAK_SENTINEL`, `LeakFlow`, `runLeakFlow`, `expectCleanRun`, `exposuresOf`, `plantThirdPartyTelemetry`, `plantThirdPartyCounter` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build -w packages/telemetry` | Compile to `dist/` (other workspaces import the built output) |
| `npm run dev -w packages/telemetry` | Rebuild on change |
| `npm run test -w packages/telemetry` | Run this package's tests (vitest, `_tests/`) |
| `npm run typecheck -w packages/telemetry` | Typecheck `src/` and `_tests/` |
