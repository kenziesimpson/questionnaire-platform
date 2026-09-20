---
name: telemetry-safety
description: How to add telemetry to this repo without leaking a respondent's answer — the closed field registry, the scrub, what the types do and do not protect, and the leak-test flow every such PR must extend. Use whenever you add or change a log line, a span, a metric or counter, a domain event, a telemetry field, an error or problem response that gets logged, an exporter, the `/telemetry` ingest, a browser telemetry call, anything that puts request or response data near telemetry, or the leak test itself.
---

# Telemetry safety — an answer never enters telemetry

**The rule.** Respondent answer values never enter telemetry. Not in a log, a span attribute, a
metric label, a span name, a status message or an error, at any level, in any signal, in any
environment. Question identifiers, question types and validation outcomes *are* telemetry. The
values respondents typed are not. Full reasoning: [[6-observability#3. Respondent answers must never enter telemetry]]
and decision O2. Error bodies are covered by the same rule
([[7-application-boundary#5.5 Error bodies must not echo answers]]).

## The ladder, as it actually exists

[[6-observability#3.1 Enforcement ladder]] names six layers. Layers 0, 1, 2, 3 and 5 are built; the pre-commit hook in layer 3 and the agent review in layer 4 are not.

| Layer | Where it lives | Catches | Does not catch |
| --- | --- | --- | --- |
| 0 — `Sensitive<T>` | `packages/shared/src/sensitive.ts` | Anything that serializes an answer: `JSON.stringify`, a template, `String()`, `util.inspect`, an OTel attribute. Each returns `[redacted]` | An answer that was never wrapped, or one pulled out with `.unwrap()` |
| 0 — literal-only message | `LiteralMessage` in `packages/telemetry/src/logger.ts`, and the `local/no-cast-into-telemetry-text` rule in `eslint.config.mjs` | `` log.info(`rejected ${text}`) `` and a `string` variable as a message, at compile time; a cast into a literal type, `never` or `any` as a message, a `logger(...)` module name or a `withSpan(...)` name, as a lint error, which fails `npm run lint` and CI | The false negatives listed under hole 1: the rule matches syntax, not types |
| 1 — one boundary | `packages/telemetry`, plus the `telemetryOnly` rule in `eslint.config.mjs` | Any other workspace importing `pino`, `pino-*`, `@opentelemetry/*` or `@fastify/otel` | Nothing else writes telemetry, so this is the whole surface |
| 1 — closed registry | `FIELDS` in `packages/telemetry/src/fields.ts` | An unknown context key, at compile time via `TelemetryContext` | A known key holding the wrong content — see below |
| 1 — the scrub | `packages/telemetry/src/scrub.ts`, at call time in `logger.ts`, `spans.ts` and, for counter labels, `events.ts` (`labelsOf`), and again at export time in `exporters.ts` and the pino formatter in `pipeline.ts` | Unregistered keys, values failing their `accepts` check, free text, objects, a `Sensitive`, unbounded attributes on a metric, a span name outside `SPAN_NAMES` or the instrumentations' shapes, a logger module outside `LOG_MODULES`. Drops, and telemetry's own swallowed failures (reason `internal`), are counted in `telemetry.scrub.dropped{signal,reason}`, never by key | A value that passes its field's shape check |
| 2 — the leak test | `apps/backend/_tests/leak-test/`, `packages/telemetry/_tests/leak-test.test.ts`, `packages/telemetry/_tests/browser/leak-test.browser.test.ts` (the browser queue, beacon and error capture) | A planted `LEAK_SENTINEL` reaching any exported span, metric data point or pino line, on any registered flow, with Fastify's instrumentation on and the app built after it, so the export-time scrub sees real `request` and handler spans, plus a planted third-party span and counter. Removing the exporter scrub fails the gate, on a real-app flow as well as the planted one | A code path no flow runs, which is why extending it is mandatory. The holes listed below. `pg` spans, which never appear under test: `pg` is imported before the instrumentation starts and there is no loader hook, so the driver is not patched and no query span is produced. The pino formatter in `pipeline.ts`, which runs the same function as the call-time scrub and cannot be reached separately; only `packages/telemetry/_tests/pipeline.test.ts` covers it |
| 3 — CI as the gate | the `leak-test` job, displayed as "Response telemetry leak test", in `.github/workflows/ci.yml` | A red leak test turns that job red on the PR | Nothing locally. There is no pre-commit hook yet, so CI is the only gate |

Layer 4, the advisory agent review on the PR, is documented and not built. Layer 5 is this file.

## Known holes

These are real and not fixed. The leak test's negative controls in
`apps/backend/_tests/leak-test/leak-test.test.ts` each target one of them, so the gate is shown to fail.

1. **The log message is guarded by its type and a syntactic lint rule only.** `LiteralMessage` is
   erased at runtime and a message is written as given, so `log.info(value as "message")` puts the
   string straight into the output. `local/no-cast-into-telemetry-text` is a lint error on a cast to a
   literal, a union of literals, `never`, `any`, `LiteralMessage`, `LogModule` or `SpanName` as the
   first argument of `logger(...)`, `withSpan(...)` or a `debug`/`info`/`warn`/`error` call on a logger
   the same file created with `logger(...)`, both imported from `@qp/telemetry`. It matches syntax, so
   it does not see: a cast hoisted into a variable, a cast through a type alias, a computed call
   (`log["info"](...)`), a logger held under another name, a wrapper around the logger, a call through a
   namespace import, a logger created in another file, or a cast in a later argument. Only a reviewer
   or the leak test stops those. Never cast into a message. If you need a
   variable message, you need a field instead. Closed since the first version of this list: the span
   name (`SPAN_NAMES`, checked in `withSpan` and again at export) and the logger's module name
   (`LOG_MODULES`).
2. **Slug- and route-shaped fields cannot tell an answer from an id.** `itemId` and `lastItemId` accept
   any slug (`^[a-z][a-z0-9_]{0,63}$`), so a one-word lower-case answer such as `diabetes` put in one
   passes. `route` accepts any lower-case literal path segment, so `/diabetes` passes, as do `/90210`
   and `/2026-01-01`, since a literal segment may hold digits and dots; the scrub cannot know a static
   segment from a word. It also rejects two things Fastify allows, `/:a-:b` and `/:id.json`, so a route
   written that way is dropped and counted. `constraint` accepts any lower-case snake-case name
   with an underscore, so `type_2_diabetes` passes. Ids and routes come from the database, the route
   table or the author's definition. Never from an answer, a label or anything a respondent typed.
   Closed since the first version of this list: `sessionId`, `questionnaireId`,
   `questionnaireVersionId`, `questionId` and `requestId` are UUIDs, and a word, phrase, date or number
   no longer passes.
3. **Other fields are shaped, not closed.** `errorType` accepts any capitalised alphanumeric name
   (`Diabetes`), `errorCode` any five characters from `0-9A-Z` (`12345`, a US zip code), `invariant` any
   dotted lower-case name (`a.b`), `exception.type` (what OpenTelemetry records for an exception, its
   `code` if it has one, else its `name`) a class name, an `ERR_` or `FST_ERR_` code or a five-character
   SQLSTATE, and `db.name`, `db.namespace` and `server.address` any token. Same rule: none of them
   comes from an answer. `errorType` is a class name, so a raw `pg` `DatabaseError`, whose `name` is
   the lower-case `error`, loses its `errorType`; Drizzle wraps it today and the SQLSTATE and
   constraint name are still recorded.
4. **Strings the exporter copies through unscrubbed.** A span event's name, a metric's name,
   description and unit, the instrumentation scope's name and version, and the resource attributes all
   reach export as written. They are code constants in our code and in the instrumentations, so no
   answer reaches them today, but nothing checks them, and the leak test would only see one if a flow
   planted it there. If a change lets a variable reach any of these, it needs a runtime check first.
   Span names are checked, and what still passes is precise: `request`; `<hook> - <name>`, where the
   hook is one of Fastify's lifecycle hooks, `handler`, or `notFoundHandler` (alone or with
   `preValidation` or `preHandler`), and the name is a camel-case identifier (`[a-z][A-Za-z0-9]*`,
   which includes `anonymous`) or the literal plugin fallback `fastify -> @fastify/otel`; and
   `pg.query`, `pg.query:<verb>` with the verb from a closed list, `pg.connect` and `pg-pool.connect`.
   The database slot of `pg.query:<verb> <db>` is never exported: the exporter rewrites it to
   `pg.query:<verb>`, so a planted `pg.query:SELECT <sentinel>` in any case is clean. What remains is
   the `<name>` slot: a one-word lower-case camel-case name such as `handler - diabetes` passes, and
   the exporter cannot tell it from a function name. Function names are source identifiers, not data.
   The leak test plants the sentinel in a handler slot in upper and lower case, and both are rejected
   only because the sentinel contains an underscore.
5. **The stack check is a shape check.** `stackFramesOf` drops the `Error` header by the message's own
   line count and records nothing if the stack does not line up, which closed the case of a
   multi-line message with a frame-shaped line. What remains passes if it looks like a frame
   (`    at name (file:1:2)`). Never build an error message from an answer, and never construct an
   `Error` from one. The leak test's `errors` and `500 path` flows keep the closed case closed.
6. **The leak test cannot see everything it plants.** It matches a string sentinel, in any case, by text.
   A numeric or date answer put in `elapsedSeconds`, `durationMs` or a similar number field is not
   detectable by it. A value that was truncated, hashed, encoded or split before it was logged is not
   matched either. Review those by reading the diff, not by the leak test.

The negative controls target holes 1 and 2 and the metric label of hole 3: a sentinel cast into a log
message, a slug-shaped token in `itemId`, a route-shaped token in `route`, and a constraint-shaped token
on a metric label. When one of them starts failing because the runtime now guards that channel, replace
it with a channel that is still open; do not delete it.

The scrub drops free text, wrong shapes and closed-list mismatches. It cannot tell a slug-shaped answer
from a slug. Nothing downstream can either.

## Adding a field

One entry in `FIELDS` in `packages/telemetry/src/fields.ts`, and a row in the table in
`packages/telemetry/README.md`. A reviewer then sees the whole change on one line.

```ts
questionType: oneOf("questionnaire.question_type", RESPONSE_TYPES),
```

- Use `oneOf` for a closed list, `quantity` for a number, `statusCode`, or `matching` with a tight
  regex. Set `bounded: true` — which `oneOf` and `statusCode` do for you — only if every possible
  value is one of a small fixed set, because `bounded` is what makes a value legal as a metric label
  ([[6-observability#7. Cardinality and metric hygiene]], O6).
- The field's type must not be able to carry free text. Never add a field whose value can be an
  answer, a title, a label, a detail, a message, a URL or a query string.
- `TelemetryContext` and `FieldName` derive from `FIELDS`, so the new key is available everywhere at
  once and nothing else needs editing.
- Once the `/telemetry` ingest and the browser builds exist, field changes go expand-then-contract
  (O17): the Collector accepts a new field before any build sends it, and stops accepting a removed
  one only after no deployed build sends it. A tab open across a deploy then loses one field rather
  than its whole batch.

## Adding a log line

```ts
import { logger } from "@qp/telemetry";

const log = logger("execution");

log.warn("answer rejected", { sessionId, itemId, questionId, reason: "answer/required" });
log.error("submit failed", { sessionId, status: 500 }, error);
```

`logger("<module>")` takes one of `LOG_MODULES` in `packages/telemetry/src/vocabulary.ts`; a new module
is one more member. Levels are `debug`, `info`, `warn`, `error`;
there is no `fatal`. The message is a literal. The context holds registry fields only. The third
argument is an `Error`, and only `error.name` and its stack frames are recorded — never
`error.message`, because a message can carry a value.

Wrong, and why:

```ts
log.info(`rejected ${answer.text}`, { sessionId });
log.error("submit failed", { sessionId, detail: problem.detail }, error);
log.info("request done", { ...request.body, sessionId });
```

The first two are compile errors. The third is not: a spread escapes excess-property checking, so it
typechecks, and the scrub then drops the unknown keys and counts them. That is a backstop, not a
design — if the body happened to carry a key named `itemId` holding a one-word answer, it would be
exported, because a slug cannot be told from a word. Never spread a caller-supplied object into a context.

`apps/backend/src/http/request-logger.ts` is the worked example. It receives Fastify's `req`/`res`
objects and projects them through `FIELDS[…].accepts`, keeping `method`, `route`, `status`,
`responseTimeMs`, `errorType` and `errorCode`. It logs `routeOptions.url`, the route template, never
`req.url` — O13: a session id in a path is a bearer credential.

## Adding a span, an event, a metric

**Span.** `withSpan(name, context, fn)` from `@qp/telemetry`. `SpanName` is derived from `SPAN_NAMES`
(`questionnaire.publish`, `rule.evaluate`, `session.submit`); a new span name is one more member of
that array in `packages/telemetry/src/spans.ts`. A name outside the array never throws: `withSpan` runs
`fn` with no span and counts a `span/unknown` drop. The exporter applies the same list, and renames any
span whose name is neither declared nor one of the instrumentation shapes in hole 4 to `unnamed`. Name
route handlers and hook functions: an anonymous one is named after its plugin by `@fastify/otel`, and a
name outside those shapes shows up as `unnamed` and a `span/unknown` drop on every request. Context goes through the
registry and is scrubbed like a log line. On a throw the span gets `error.type` and `ERROR` status with
no status message.

```ts
await withSpan("session.submit", { sessionId, questionnaireVersion }, async () => submit());
```

**Domain event.** One entry in `DOMAIN_EVENTS` in `packages/telemetry/src/events.ts` carrying the
event's name, its payload type and its counter name; `DomainEvent` and the counter lookup derive
from it. The payload's fields should all be registry fields, but nothing enforces it: the entry's payload type is not checked against `FIELDS`, and a key outside the registry is dropped at runtime, so a misspelt key vanishes from the log line and the counter instead of failing the build. See the `DOMAIN_EVENTS` example in
`.claude/skills/constants/SKILL.md` rather than restating the shape here. `emitDomainEvent` writes
the log line and increments the counter in one call so the two cannot drift.

**Metric.** Counter and histogram instruments live in `packages/telemetry/src/instruments.ts` and
are deliberately not exported from `@qp/telemetry`; application code reaches metrics through
`emitDomainEvent`. Labels must be `bounded` fields — the export-time scrub drops an unbounded
attribute from a metric with reason `unbounded`. Ids belong in traces and logs only (O6).

## Browser telemetry

`@qp/telemetry/browser` batches the browser's log and domain events and sends them through a
caller-supplied `send` and `beacon` ([[6-observability#6. Client-side telemetry]], O5, O8, O17,
O19). The rules are the server's rules, applied before anything is queued:

- Events carry registry fields only. `createEventQueue` runs the same `scrubAttributes(…, "log")` as
  the pino formatter, drops an unknown or ill-shaped field and keeps the event, and replaces a message
  that is not a lower-case literal shape (or not a string) with `unnamed`. App code calls `enqueue`,
  whose message is a `LiteralMessage` and whose attributes cannot name `error.stack`; `enqueueRecord`
  is for the logger sink and `captureError`. The shape check cannot tell a lower-case answer from a
  message, and `local/no-cast-into-telemetry-text` does not cover `enqueue`, so never cast into a
  browser log message either.
- A screen is a route template the caller supplies, accepted only by the `route` field. Never a URL,
  a query string, a cursor or an element's text: a clicked option's label is an answer.
- An error is its class name and stack frames, through `stackFramesOf`, with every frame rewritten by the queue
  to a script file name and an identifier-shaped function name (a computed key or a URL in a frame
  cannot pass). What a safe frame is has one home, `packages/telemetry/src/frame-shape.ts`, used by
  the rewriter (`browser/frames.ts`) and by the ingest's validator (`isBrowserStack`); change the shape or a cap
  there, never in one of them. Never read `event.message`, `event.filename` or `error.message`, and never build
  an `Error` from an answer. `installErrorCapture` and `captureError` are the only way an error
  reaches the queue; an app's error boundary calls `captureError`, not `log.error(…, error)` with
  anything else attached.
- `debug` is never queued. An app may pass a `debug` function to `routeLogsToQueue` in a development
  build only.
- No session replay, DOM capture, `instrumentation-fetch` or patched global `fetch` (O12). The app's
  one `fetch` wrapper calls `injectTraceHeaders`, which adds a `traceparent` and nothing else.
- Keep the entry point browser-safe: no `node:` import, `pino`, `./node`, `./testing` or `./leak-test`.
  `packages/telemetry/_tests/browser.test.ts` reads the import graph and fails on one.
- A new browser code path extends `packages/telemetry/_tests/browser/leak-test.browser.test.ts`, which
  plants the sentinel in an unknown field, a known field's value, an error message, a stack line, a
  screen and a domain event, and asserts it is in neither the sent batch nor the beacon.
- The wire mapping from the queue to the ingest's envelope has one home, `src/browser/wire.ts`, and one table of what a browser may
  send, `wire-contract.ts`, which the ingest reads too. Never rename, filter or name an event anywhere else, and never mark a queued record as a domain event from a module attribute or a message: only
  `logDomainEvent`, through `emitDomainEvent`, can. A change to either end
  runs `_tests/browser/wire-contract.leak-test.test.ts`, which sends real queue output through the real `ingestBatch` and fails on
  any dropped event or `unknown_field`, `invalid_field`, `unknown_event`, `malformed` or `invalid_trace` count.

## The ingest door

`POST /api/telemetry` (`modules/telemetry`, `ingestBatch` in `packages/telemetry/src/ingest.ts`) is the one place telemetry
arrives from outside. It has no database and never logs a body. It accepts an event only if its name is a
client log event (`client.` and a level from `CLIENT_LOG_LEVELS`) or a `BROWSER_DOMAIN_EVENTS` member, keeps a field only if `judgeBrowserField` (`wire-contract.ts`) finds it on that event's list and `FIELDS` accepts it (`errorStack` also has to pass the
stricter `isBrowserStack`), and counts every drop in `telemetry.ingest.dropped{reason}`. Before adding a browser event, ask whether the server could emit it itself;
an event the server owns stays off the allowlist, so a browser cannot move its counter. A client log line carries no message: its
level is its name. Hole 2 applies in full: the ingest cannot tell a slug-shaped `itemId` or a route from a one-word answer, so a
browser build must take them from the definition and the route template. Never log or count an ingested name, timestamp,
traceparent or rejected value.

## Never in telemetry

- An answer value in any form: raw, `JSON.stringify(answer)`, `` `${answer}` ``, `String(answer)`.
- The output of `Sensitive.unwrap()`. Unwrapping happens in validation and persistence, nowhere near
  a log call.
- A request or response body, or any part of one.
- A problem's `title`, `detail` or `instance`. `instance` is the full URL and carries a session id;
  `detail` is free text; and a problem must never echo an answer to begin with
  ([[7-application-boundary#5.5 Error bodies must not echo answers]]). Log a problem through
  `problemTelemetry(body)` from `@qp/telemetry`, which keeps the slug, status, item codes and item ids
  (O8); `sendProblem` in `apps/backend/src/http/problems.ts` already does.
- `error.message`. Class name and stack frames only.
- URLs, query strings and pagination cursors. `http.route` only. The responses-list `cursor` encodes
  a session id, which is exactly why (O13, O19).
- Free text of any kind: option labels, question prompts, other-text, questionnaire titles.
- A whole `req`, `res` or `err` object, and any spread of a caller-supplied object.

## Extending the leak test — the standing rule

**Every lane PR that adds a code path touching answers, telemetry, or the wire between them extends
the leak test in the same PR.** One entry in `LEAK_FLOWS` in `apps/backend/_tests/leak-test/flows.ts`,
plus a row in [[8-testing]] §7.

A flow is `{ name, run(world, sentinel) }`. `run` plants `sentinel` where the real data would be and
drives the real path — a real request through `app.inject`, a real stored row, a real read-back.

```ts
{
  name: "reporting: the stored sentinel answer read back through the responses list and the response detail",
  run: async (world, sentinel) => {
    const sessionId = await submitPlantedResponse(world, sentinel);
    const detail = await world.app.inject({ method: "GET", url: sessionDetailUrl(INTAKE_QUESTIONNAIRE_ID, sessionId) });
    expect(detail.statusCode).toBe(200);
    expect(detail.body, "the read-back must return the planted answer for the flow to prove anything").toContain(sentinel);
  },
}
```

- **Assert your own plant took.** Check the status code, the stored row, the response body. A flow
  whose plant silently failed passes vacuously and proves nothing.
- **A flow that emits no telemetry fails** with `TELEMETRY LEAK TEST VACUOUS`, and so does a flow in which a telemetry call failed and was swallowed (`run.internalDrops`, reason `internal`): the drop counter is not the flow's own telemetry. If your path is silent,
  the flow is testing the wrong thing.
- **Run it against the instrumented pipeline, and build the app after it starts.** Fastify's
  instrumentation patches an app only if it is installed before `Fastify()` runs, so an app built
  earlier produces no spans at all. `runOnLeakApp(testDatabase, flow, { autoInstrumentation: true })`
  in `apps/backend/_tests/leak-test/harness.ts` builds the app inside the flow, after `runLeakFlow` has
  installed telemetry, and closes it afterwards. `run.spanNames` lists the exported span names;
  `leak-test.test.ts` asserts a real `request` and `handler - handler` appear, so the gate cannot go blind
  again. `leak-test-mutation.test.ts` removes the export-time scrub and asserts the real-app `500 path`
  flow then fails on a Fastify span. `pg` spans still do not appear under test (see the ladder). `plantThirdPartyTelemetry(sentinel)` from
  `@qp/telemetry/leak-test` adds a span and a counter carrying the sentinel in `url.path`, a body
  attribute, an exception and a status message, the way an instrumentation would.
- **Real-path flows plant the bare sentinel.** Forged-input flows, which prove the scrub drops what
  the types would have stopped, plant it in every registry field. A field whose shape would accept the
  sentinel gets a value containing whitespace instead — see `withWhitespace` in `flows.ts` — because
  a value the shape accepts is a real leak, not a forgery. The sentinel is upper case with
  underscores, so no id, route, code or constraint field accepts it; `lowerCased` in `flows.ts` plants
  the lower-case form in the fields that still reject that.
- **A flow may live in another workspace's `_tests`** when the path does not run in the backend.
  Import `runLeakFlow`, `expectCleanRun`, `LEAK_SENTINEL` and `LeakFlow` from
  `@qp/telemetry/leak-test`, build your own world inside the flow so the instrumentation is already running, and end the test with
  `expectCleanRun(flow.name, run)`, which throws a plain `Error` for a leak or a vacuous flow. The
  backend's world and app come from `runOnLeakApp` in `apps/backend/_tests/leak-test/harness.ts`.
- **Keep `leak-test` in the path of a test that imports `@qp/telemetry/leak-test`.** `npm run test:leak-test`
  selects by that word. `tests/leak-test-selection.test.ts` fails when such a test does not carry it,
  so a flow cannot quietly fall outside the gate step.

Flows built so far: the submit, rejection, past-cutoff, skipped-item and replay paths of the execution
module, and the `/api/telemetry` ingest, with a batch that carries the sentinel in a field, a nested
object, an event name, a timestamp and a traceparent, and batches refused as not an envelope. Flows still owed, by the lane that builds each path: the apps' use of the
browser SDK, both the admin response-detail screen and the respondent app, through their telemetry wrapper (O20);
the `view_response` audit path (O14); and any new reporting read. The definition routes' flow plants the sentinel in a title,
a prompt and an option label, and takes a draft through a stale save, a refused publish, a publish and a retirement.

## The gate

`npm run test:leak-test` runs `vitest run leak-test`, which is the `packages/telemetry` detector tests plus
the backend gate. CI runs it as its own "Response telemetry leak test" job, beside the unit-test shards, and the same tests run again
inside those shards. A failure prints `TELEMETRY LEAK TEST FAILED` naming
the flow and the signal that carried the sentinel.

**Never weaken the gate to get CI green.** Do not `.skip` a flow, delete one, loosen an assertion,
narrow the detector, change the sentinel, or remove a negative control. A red leak test means a value
reached telemetry — find the leak. If a negative control starts failing because the runtime now
guards that channel, replace it with a control for a channel that is still open — one that passes its
shape check — and keep at least one control per signal (log, span, metric); do not delete it, because
the file's purpose is to prove the gate can fail.

## Before opening the PR

1. Every new context key is in `FIELDS`, with a check that cannot admit free text, and the README
   table has its row.
2. Every id field is filled from the database, the route or a generator — never from an answer, a
   label or user text.
3. No cast into a log message, a logger module name or a span name, anywhere in the diff, including the
   forms the lint rule cannot see.
4. No `.unwrap()` outside validation and persistence.
5. No body, problem `title`/`detail`/`instance`, `error.message`, URL, query string or cursor in any
   signal; no spread of a caller-supplied object into a context.
6. Any new metric label is a `bounded` field.
7. A new domain event is one entry in `DOMAIN_EVENTS`, with a payload of registry fields you have checked by eye.
8. If the diff touches answers, telemetry or the wire between them, it adds a `LEAK_FLOWS` entry
   that plants the sentinel on the real path, asserts the plant took, and emits telemetry.
9. That flow has a row in [[8-testing]] §7.
10. `npm run test:leak-test` passes locally, and no existing flow, negative control or assertion was
    loosened to make it pass.
11. Telemetry never throws into the caller: any call the business path makes returns normally when its sink, instrument or scrub throws. It catches through `guarded` or `guardedOr` in `packages/telemetry/src/guard.ts` (`scrub.ts` and `instruments.ts` have their own `try`/`catch` because `guard.ts` imports `instruments.ts`), emits nothing partial (a span with a hostile context exports with no attributes) and counts the failure as `telemetry.scrub.dropped{reason=internal}`. A test in `packages/telemetry/_tests/` proves it. Never log or read the caught error's message. The leak test fails a flow whose run has an internal drop, so a swallowed failure cannot pass as a clean run.
