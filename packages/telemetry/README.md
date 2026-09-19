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
3. **Lint.** `eslint.config.mjs` rejects importing `pino` or OpenTelemetry anywhere else, and warns
   on a cast into a log message, a logger module name or a span name, which is the one channel the
   scrub cannot see (a message is written as given).

## Entry points

| Import | Use it for | Loads |
| --- | --- | --- |
| `@qp/telemetry` | `logger`, `withSpan`, `emitDomainEvent`, the field registry and its types | `@opentelemetry/api` only; safe for a browser bundle |
| `@qp/telemetry/node` | `startTelemetry`: starts the SDK, pino and the auto-instrumentation; `runningTelemetry`: the handle it returned, until that handle shuts down | the Node SDK, exporters, pino |
| `@qp/telemetry/testing` | `installTestTelemetry`: in-memory exporters for tests | the Node SDK |
| `@qp/telemetry/canary` | `CANARY_SENTINEL`, `runCanaryFlow`, `expectCleanRun`, `exposuresOf`, `plantThirdPartyTelemetry`, `plantThirdPartyCounter`: the sentinel canary's detector, runner and assertion | the Node SDK |

Application code imports the first. Only the backend's `src/telemetry.ts` (used by the preload and the entry point) imports
the second, and only tests import the third and fourth.

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
  and a cast that defeats the type (`value as "message"`, `as never`) is a lint warning. Nothing checks
  a message at runtime, so this is the one field whose guard is the type and the warning alone.
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
| `errorType` | `error.type` | a class name: a capital letter, then letters and digits | yes |
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

## Spans

```ts
await withSpan("session.submit", { sessionId }, async () => submit());
```

- `SpanName` is derived from `SPAN_NAMES` (`questionnaire.publish`, `rule.evaluate`, `session.submit`); a
  new span is one more member of that array.
- A name outside `SPAN_NAMES`, which only a cast or an untyped caller can pass, does not throw: `withSpan`
  runs the callback with no span and counts one `span/unknown` drop.
- Context becomes attributes through the registry, so it is scrubbed like a log line.
- On a throw the span is marked `ERROR` with `error.type` only, no status message, and the error is
  rethrown.
- Logs written inside the callback carry its `trace_id` and `span_id`.

The exporter applies the same list to every span it sees. A declared name and the names the
instrumentations produce (`request`, a Fastify hook or handler span such as `handler - getSession`,
`pg.query:SELECT`, `pg.connect`, `pg-pool.connect`) pass. Any other name is exported as `unnamed`, and
the span, its parent link and its scrubbed attributes are kept, so the trace stays whole. That costs one
`span/unknown` drop per such span, which is how a new instrumentation shows up.

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
| `session.answer_rejected` | `questionnaire.answers.rejected`, labelled by `reason` |
| `session.item_skipped` | `questionnaire.items.skipped` |

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

## The canary

`@qp/telemetry/canary` is the detector and runner behind the sentinel canary
([`docs/8-testing.md`](../../docs/8-testing.md) §2.5). A flow plants `CANARY_SENTINEL` where an answer
value would be and runs one code path; the runner then reports every span, metric data point and log
line that carries it.

```ts
import { CANARY_SENTINEL, runCanaryFlow, type CanaryFlow } from "@qp/telemetry/canary";

const flow: CanaryFlow<World> = { name: "…", run: async (world, sentinel) => { … } };
const { exposures, observed } = await runCanaryFlow(flow, world);
```

| Export | Returns |
| --- | --- |
| `runCanaryFlow(flow, world, options?)` | Installs test telemetry (`options.autoInstrumentation` turns on the Fastify and `pg` instrumentations), runs the flow, and returns `exposures` (signal and name of each leak) and `observed` (how many logs, spans and metrics the flow emitted). It shuts the pipeline down even when the flow throws |
| `expectCleanRun(name, run)` | Throws a plain `Error` if the run has an exposure, or if the flow emitted nothing |
| `plantThirdPartyTelemetry(sentinel)` | Emits spans, one named for the sentinel, and a counter carrying the sentinel the way a third-party instrumentation would, to exercise the export-time scrub |
| `plantThirdPartyCounter(labels)` | Emits a counter with exactly these labels, so a negative control can put a shaped value on a bounded metric label |
| `exposuresOf(telemetry)` | Every log line, span and metric whose serialised form contains the sentinel, keys included, in any case |

The flows live with the code they exercise. The backend's registry is
`apps/backend/_tests/canary/flows.ts`; `npm run test:canary` runs it and CI gates on it.

## Layout

| File | Contents |
| --- | --- |
| `src/index.ts` | The core entry point's exports |
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
| `src/canary.ts` | `CANARY_SENTINEL`, `CanaryFlow`, `runCanaryFlow`, `expectCleanRun`, `exposuresOf`, `plantThirdPartyTelemetry`, `plantThirdPartyCounter` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build -w packages/telemetry` | Compile to `dist/` (other workspaces import the built output) |
| `npm run dev -w packages/telemetry` | Rebuild on change |
| `npm run test -w packages/telemetry` | Run this package's tests (vitest, `_tests/`) |
| `npm run typecheck -w packages/telemetry` | Typecheck `src/` and `_tests/` |
