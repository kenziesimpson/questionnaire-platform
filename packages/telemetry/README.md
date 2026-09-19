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
| `@qp/telemetry` | `logger`, `withSpan`, `emitDomainEvent`, the field registry and its types | `@opentelemetry/api` only; safe for a browser bundle |
| `@qp/telemetry/browser` | `createEventQueue`, `startBrowserTelemetry`, `installErrorCapture`, `injectTraceHeaders`, `afterFirstPaint`: the browser SDK | the core, `@opentelemetry/api`, `@opentelemetry/sdk-trace-web`; no Node built-in, `pino`, `./node`, `./testing` or `./leak-test` |
| `@qp/telemetry/node` | `startTelemetry`: starts the SDK, pino and the auto-instrumentation; `runningTelemetry`: the handle it returned, until that handle shuts down | the Node SDK, exporters, pino |
| `@qp/telemetry/testing` | `installTestTelemetry`: in-memory exporters for tests | the Node SDK |
| `@qp/telemetry/leak-test` | `LEAK_SENTINEL`, `runLeakFlow`, `expectCleanRun`, `exposuresOf`, `plantThirdPartyTelemetry`, `plantThirdPartyCounter`: the sentinel leak test's detector, runner and assertion | the Node SDK |

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
| `createEventQueue({ send, beacon, screen?, maxPending?, batchSize?, flushIntervalMs? })` | A bounded queue of `{ level, message, attributes }` events. `enqueue({ level, message, attributes })` is the form for app code: the message is a literal (`LiteralMessage`, as in `logger`), the level is not `debug`, and the attributes cannot name `error.stack`. `enqueueRecord` takes a plain record and is for `routeLogsToQueue` and `captureError`. Both scrub before they queue and never throw; `flush()` sends through `send`; `flushOnExit()` hands everything left to `beacon`; `close()` stops the timer and every later send, and ignores later events; `stats()` reports pending, sent and every drop |
| `routeLogsToQueue(queue, { debug? })` | Points `logger(...)` and `emitDomainEvent` at the queue. `debug` never reaches it: it goes to the optional `debug` function, which an app passes only in a development build |
| `flushOnPageHide(queue, window)` | `flushOnExit()` on `pagehide` and when `visibilitychange` finds the page hidden |
| `installErrorCapture(queue, window)`, `captureError(queue, kind, error)` | An `error` and an `unhandledrejection` listener, and the same capture for an error boundary. Records the error's class name and its stack frames only. Installing twice on one page adds no second listener |
| `startBrowserTracing()`, `stopBrowserTracing()`, `injectTraceHeaders(headers)` | A web tracer provider with a synchronous context manager, and the `traceparent` of the active span added to a headers record. With no active span the headers come back without any `traceparent`, so a stale one is never propagated. No `instrumentation-fetch` and no patching of global `fetch` (O12): the app's one `fetch` wrapper calls `injectTraceHeaders` by hand |
| `afterFirstPaint(start, window)` | Runs `start` in a `requestIdleCallback` after `load`, or a timeout after `load` where there is none; returns a cancel function |
| `startBrowserTelemetry({ page, ...queue options, debug? })` | Tracing, the queue, log routing, page-hide flush and error capture in one call; `stop()` undoes them, hands what is queued to `beacon` and closes the queue, so nothing is sent afterwards. A second call while one is running returns the running handle |

Rules the code holds:

- **The browser scrubs before anything is queued.** An event keeps only registry attributes, through the same `scrubAttributes(…, "log")` the pino formatter and exporters run. An unknown or ill-shaped field is dropped and counted in `stats().droppedFields`; the event stays (O17). A message that is not a lower-case literal shape (`^[a-z][a-z0-9 ._:-]{0,79}$`) is replaced by `unnamed`. That is a shape check: a lower-case token passes it, as it does the server's message.
- **A screen is a route template**, supplied by the caller and accepted only if the `route` field accepts it (O19). A URL, a query string, a cursor or free text is dropped.
- **An error is its class name and its frames, never its message.** `stackFramesOf` still decides whether the stack lines up with the message and keeps only frame-shaped lines; the queue then rewrites every frame of any `error.stack` it is given, from `captureError`, the logger or a caller alike. The location becomes the last path segment's script file name, `index-3f9a.js:10:20`, or `anonymous.js` for anything else, so no page URL, session id or query string survives. The function name is kept only if it is an identifier path (`Object.<anonymous>`, `async Promise.all`, `new Screen`, no interior underscore or space) and is otherwise `anonymous`. That is a shape check, so a one-word lower-case function name derived from an answer would pass; never build one from an answer. Stack frames in another browser's format (`fn@url:1:2`) do not line up, so those errors carry a type and no frames. The capture never reads an error event's `message`, `filename` or position.
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

- `logger("<module>")` takes one of `LOG_MODULES` (`backend`, `definition`, `events`, `execution`,
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
| `questionType`, `outcome`, `reason`, `method`, `signal` | `questionnaire.question_type`, … | a member of a closed list | yes |
| `status` | `http.response.status_code` | an integer from 100 to 599 | yes |
| `route` | `http.route` | a route template: `/`, or lower-case literal segments and `:name`, `$name`, `{name}` or `*` parameters, with no query string or fragment | yes |
| `errorType` | `error.type` | a class name: a capital letter, then letters and digits (a raw `pg` `DatabaseError`, named `error`, has none) | yes |
| `errorCode` | `error.code` | a five-character SQLSTATE (`23505`, `QP001`) | yes |
| `invariant` | `error.invariant` | a dotted lower-case name with at least one dot (`session.not-marked-submitted`) | yes |
| `constraint` | `db.constraint` | a lower-case snake-case Postgres constraint name with at least one underscore | yes |
| `problem`, `problemCode` | `problem.slug`, `problem.code` | a problem slug; a question rule, draft item, submission item or known schema code | yes |
| `pool` | `db.pool` | `definition`, `execution` or `reporting` | yes |
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

A value is dropped for one of three reasons, in `DROP_REASONS`:

| Reason | Meaning |
| --- | --- |
| `unknown` | The key is not in the registry or the infrastructure allowlist |
| `invalid` | The key is known but the value fails its check: free text, wrong type, an object, a `Sensitive` |
| `unbounded` | A metric carried an attribute that is not bounded |

Drops are counted in the `telemetry.scrub.dropped` counter, labelled by signal (`log`, `span`,
`metric`) and reason, and never by key.

Infrastructure attributes are a small allowlist of safe OpenTelemetry names an instrumentation
attaches on its own (`db.system`, `server.port`, `fastify.type`, …). `url.path`, `url.full`,
`db.statement`, request bodies and exception messages are deliberately absent.

### Where it runs

| When | Where | What is scrubbed |
| --- | --- | --- |
| Call time | `logger.ts`, `spans.ts`, `instruments.ts` | The caller's context, through `scrubContext` |
| Log output | the pino `formatters.log` hook in `pipeline.ts` | The final object, through `scrubAttributes(…, "log")` |
| Export time | `exporters.ts` | Every span's name, attributes, events and links, and every metric data point, before they reach OTLP |

The export-time layer is the one that catches what the types cannot see: a third-party
instrumentation attaching a request body, or an exception event carrying a message.

It scrubs span names, span and event and link attributes, span status and metric data-point
attributes. It does **not** scrub a span event's name, a metric's name, description or unit, the
instrumentation scope's name and version, or the resource attributes: they reach export as written.
They are code constants in this repo and in the instrumentations, so no answer reaches them today, but
nothing checks them. A change that lets a variable reach any of them needs a runtime check first.
The known holes are listed in `.claude/skills/telemetry-safety/SKILL.md`.

## Spans

```ts
await withSpan("session.submit", { sessionId }, async () => submit());
```

- `SpanName` is derived from `SPAN_NAMES` (`questionnaire.publish`, `rule.evaluate`, `session.submit`); a
  new span is one more member of that array. The backend wraps a submit in `session.submit` and its answer
  evaluation in `rule.evaluate`, and adds `outcome` to the first once it is known.
- A name outside `SPAN_NAMES`, which only a cast or an untyped caller can pass, does not throw: `withSpan`
  runs the callback with no span and counts one `span/unknown` drop.
- Context becomes attributes through the registry, so it is scrubbed like a log line.
- On a throw the span is marked `ERROR` with `error.type` only, no status message, and the error is
  rethrown.
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
emitDomainEvent({ name: "session.answer_rejected", sessionId, itemId, questionId, reason: "answer/required" });
```

One call writes an `info` log line named for the event and increments a counter, so the two cannot
drift. `DomainEvent` is a closed union whose fields are all registry fields.

Each event is defined once, in the `DOMAIN_EVENTS` table in `src/events.ts`: its name, its payload
type and its counter name on one entry. `DomainEvent` and the counter lookup are derived from that
table, so adding an event is one entry.

```ts
"session.answer_rejected": event<{ sessionId: string; itemId: string; questionId: string; reason: SubmissionItemCode }>(
  "questionnaire.answers.rejected",
),
```

| Event | Counter |
| --- | --- |
| `questionnaire.created`, `.published`, `.retired` | `questionnaire.created`, `.published`, `.retired` |
| `session.started`, `.resumed`, `.abandoned`, `.completed` | `questionnaire.sessions.started`, `.resumed`, `.abandoned`, `.completed` |
| `session.question_answered` | `questionnaire.answers.accepted`, labelled by `questionType` |
| `session.answer_rejected` | `questionnaire.answers.rejected`, labelled by `reason`; `itemId` and `questionId` are `null` for an unknown item key, which came from the respondent |
| `session.item_skipped` | `questionnaire.items.skipped` |
| `session.rejected_past_cutoff` | `questionnaire.sessions.rejected_past_cutoff` |
| `session.submit_finished` | `questionnaire.submissions`, labelled by `outcome` |

`session.completed` also records `questionnaire.session.duration`, a histogram in milliseconds.
Counters carry bounded labels only.

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
4. Builds a `NodeSDK` with `FastifyOtelInstrumentation` and `PgInstrumentation`.

| Option | Effect |
| --- | --- |
| `otlpEndpoint` set | Traces go to `<endpoint>/v1/traces` and metrics to `<endpoint>/v1/metrics`, each through the scrub |
| `otlpEndpoint` unset or empty | Nothing is exported. Spans are still recorded, so logs carry trace ids |
| `autoInstrumentation: false` | No loader hook and no instrumentations; for tests |

`installTestTelemetry({ autoInstrumentation: true })` starts the Fastify and `pg` instrumentations without the loader hook, which is enough for Fastify to be traced under test and lets the export-time scrub see real instrumentation output.

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
| `runLeakFlow(flow, world, options?)` | Installs test telemetry (`options.autoInstrumentation` turns on the Fastify and `pg` instrumentations), runs the flow, and returns `exposures` (signal and name of each leak), `observed` (how many logs, spans and metrics the flow emitted) and `spanNames` (the exported span names). Fastify's instrumentation only patches an app created after it starts, so a flow that needs real spans builds its app inside `run`. It shuts the pipeline down even when the flow throws |
| `expectCleanRun(name, run)` | Throws a plain `Error` if the run has an exposure, or if the flow emitted nothing |
| `plantThirdPartyTelemetry(sentinel)` | Emits spans, one named for the sentinel, and a counter carrying the sentinel the way a third-party instrumentation would, to exercise the export-time scrub |
| `plantThirdPartyCounter(labels)` | Emits a counter with exactly these labels, so a negative control can put a shaped value on a bounded metric label |
| `exposuresOf(telemetry)` | Every log line, span and metric whose serialised form contains the sentinel, keys included, in any case |

`pg` spans do not appear under test: the driver is imported before the instrumentation starts and there is no loader hook, so it is not patched.

The flows live with the code they exercise. The backend's registry is
`apps/backend/_tests/leak-test/flows.ts`; `npm run test:leak-test` runs it and CI gates on it.

## Layout

| File | Contents |
| --- | --- |
| `src/index.ts` | The core entry point's exports |
| `src/browser.ts`, `src/browser/` | The browser entry point and its parts: `queue.ts`, `events.ts` (the queued event and its scrub), `errors.ts`, `frames.ts` (the stack-frame rewrite), `lifecycle.ts`, `logging.ts`, `idle.ts`, `tracing.ts`, `start.ts`, `page.ts` (the structural types for `window`) |
| `src/fields.ts` | `FIELDS`, `TelemetryContext`, the infrastructure allowlist, `OUTCOMES` |
| `src/vocabulary.ts` | Constants shared by more than one module: the instrumentation scope, signal kinds, drop reasons, log modules and the attribute names the pipeline writes about itself |
| `src/scrub.ts` | `scrubContext`, `scrubAttributes` |
| `src/logger.ts` | `logger`, `LOG_LEVELS`, `LiteralMessage`, the sink and threshold |
| `src/spans.ts` | `withSpan`, `SPAN_NAMES`, `SpanName`, `activeTraceId`, `annotateActiveSpan` |
| `src/problems.ts` | `problemTelemetry`, `PROBLEM_CODES`, `SCHEMA_CODES` |
| `src/events.ts` | `DOMAIN_EVENTS` (each event's name, payload and counter), `DomainEvent`, `emitDomainEvent` |
| `src/instruments.ts` | The counter and histogram primitives, the session-duration histogram and the drop counter |
| `src/exporters.ts` | The scrubbing decorators for span and metric exporters |
| `src/pipeline.ts` | Builds the SDK, the pino sink and the exporters |
| `src/node.ts` | `startTelemetry`, `runningTelemetry` |
| `src/testing.ts` | `installTestTelemetry` |
| `src/leak-test.ts` | `LEAK_SENTINEL`, `LeakFlow`, `runLeakFlow`, `expectCleanRun`, `exposuresOf`, `plantThirdPartyTelemetry`, `plantThirdPartyCounter` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build -w packages/telemetry` | Compile to `dist/` (other workspaces import the built output) |
| `npm run dev -w packages/telemetry` | Rebuild on change |
| `npm run test -w packages/telemetry` | Run this package's tests (vitest, `_tests/`) |
| `npm run typecheck -w packages/telemetry` | Typecheck `src/` and `_tests/` |
