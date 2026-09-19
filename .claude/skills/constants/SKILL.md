---
name: constants
description: How this repo handles constants — define a value once, in the narrowest module that owns it, derive types from it rather than restating them, and know which duplication is deliberate. Use whenever you add a string or number literal that another module also writes or matches, hand-write a union type next to an array of the same members, restate a union's members as a record's keys or an order, introduce a shared constants module, or a reviewer says "define this once" or "centralise this".
---

# Constants — define once, centralise narrowly

A value that two modules must agree on is declared in one place and imported. A value that two
modules happen to share is not. Both halves matter: the duplication rule exists to stop silent
drift, not to pull every literal into a shared file.

## Centralise when

- The same literal is declared in more than one module. `"qp.telemetry"` was `METER_NAME` in
  `instruments.ts` and `TRACER_NAME` in `spans.ts`; renaming one would have split the
  OpenTelemetry scope with nothing failing.
- One module writes a value and another must match it. Every attribute name in
  `packages/telemetry/src/vocabulary.ts` is like this: `logger.ts` writes `trace_id`, and the
  allowlist in `fields.ts` has to accept it or the scrub drops the pipeline's own output.
- A set of members is written twice — once as a union type, once as an array.

## Do not centralise when

- **The sameness is coincidental.** Two values that are equal today but change for different
  reasons are two values. Sharing them couples the reasons.
- **It crosses a package boundary.** `fields.ts` lists `["SIGINT", "SIGTERM"]` for the `signal`
  field; `apps/backend/src/index.ts` has its own `as const` for `process.on`. Sharing would tie
  the backend's shutdown handling to a telemetry field list, and the compiler already checks the
  backend's values against the field's type, so drift is a compile error either way.
- **The literal is used once.** `"qp-test"` in `testing.ts`, `"/v1/traces"` and `"/v1/metrics"` in
  `node.ts`.
- **A test asserts the literal on purpose.** `_tests/node.test.ts` expects the string
  `"questionnaire.sessions.started"` so that renaming the counter fails a test instead of being
  followed silently.

## Derive, don't restate

One `as const` array is the source; the union comes from it. This is what `LOG_LEVELS` and
`OUTCOMES` already do.

```ts
export const SIGNAL_KINDS = ["log", "span", "metric"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
```

Before, the same three members existed as a hand-written union in `scrub.ts` and as an inline
array in the `telemetry.signal` allowlist entry in `fields.ts`.

Derive an order or a record's keys from that array too, rather than writing the members again:

```ts
function isBelowThreshold(level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(state.threshold);
}
```

A hand-written `RANK` record repeating the level names adds a second place to be wrong. Where
restating is genuinely unavoidable — a table that maps each member to something else — annotate it
so the compiler checks the coverage, which is an acceptable substitute for centralising:

```ts
const EVENT_COUNTERS = {
  "questionnaire.created": "questionnaire.created",
} as const satisfies Record<DomainEvent["name"], string>;
```

## Where it goes

| Situation | Home |
| --- | --- |
| One module owns the concept | That module, exported from it |
| Two siblings need it and neither can own it without an import cycle | A small shared module in the same package, named for what it holds |

`vocabulary.ts` exists only because `fields.ts` needs the values and `scrub.ts` already imports
`fields.ts`, so either home would have made a cycle. It is named for its contents — the words the
pipeline uses about itself. Do not create a package-wide `constants.ts`; a file named after its
file type collects unrelated things and nothing ever leaves it.

## Worked example — the scope name

Before, in two files:

```ts
const METER_NAME = "qp.telemetry";
const TRACER_NAME = "qp.telemetry";
```

After, in `vocabulary.ts`, imported by both:

```ts
export const INSTRUMENTATION_SCOPE = "qp.telemetry";
```

The same pass moved `SIGNAL_KINDS`, `DROP_REASONS`, `SCRUB_ATTRIBUTES` and `LOG_ATTRIBUTES` there,
gave `logger.ts` a `DEFAULT_LOG_LEVEL` that `resetLogging()` and the pipeline's shutdown both use,
named the repeated regexes in `fields.ts`, and indexed the allowlist by each entry's own
`attribute` field instead of writing every name twice.

Left alone on purpose in that same pass: the counter names in `instruments.ts`, `"qp-test"`, the
two OTLP paths, and the backend's `SIGINT`/`SIGTERM` array.

## Before adding or reviewing a constant

1. Grep the repo for the literal. A second occurrence means one definition and an import, unless
   the sameness is coincidental or crosses a package boundary.
2. If another module has to match this value, put it where both can import it.
3. If you wrote a union, write the `as const` array instead and derive the union from it.
4. If you restated members as keys or an order, derive them — or add `satisfies Record<Union, …>`
   so drift breaks the build.
5. If a new shared module is the answer, name it for the concept it holds, not `constants`.
