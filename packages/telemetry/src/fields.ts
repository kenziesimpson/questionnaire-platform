import { RESPONSE_TYPES, SUBMISSION_ITEM_CODES } from "@qp/shared";

export const OUTCOMES = ["accepted", "rejected_validation", "rejected_conflict", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

export interface FieldDefinition<V> {
  readonly attribute: string;
  readonly bounded: boolean;
  readonly accepts: (value: unknown) => value is V;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ROUTE = /^\/[A-Za-z0-9_.:*{}/-]{0,200}$/;
const TYPE_NAME = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/;
const ERROR_CODE = /^[A-Za-z0-9_]{1,32}$/;
const STACK_FRAME = /^ {4}at (?:.+ \((?:[^\s()]+:\d+:\d+|<anonymous>|native)\)|[^\s()]+:\d+:\d+)$/;
const MAX_STACK_FRAMES = 40;

function matching(attribute: string, expression: RegExp, bounded: boolean): FieldDefinition<string> {
  return {
    attribute,
    bounded,
    accepts: (value): value is string => typeof value === "string" && expression.test(value),
  };
}

function oneOf<const V extends string>(attribute: string, values: readonly V[]): FieldDefinition<V> {
  return { attribute, bounded: true, accepts: (value): value is V => values.some((known) => known === value) };
}

function quantity(attribute: string): FieldDefinition<number> {
  return { attribute, bounded: false, accepts: (value): value is number => typeof value === "number" && Number.isFinite(value) };
}

function statusCode(attribute: string): FieldDefinition<number> {
  return {
    attribute,
    bounded: true,
    accepts: (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599,
  };
}

function isStackTrace(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const frames = value.split("\n");
  return frames.length <= MAX_STACK_FRAMES && frames.every((frame) => STACK_FRAME.test(frame));
}

export function stackFramesOf(error: Error): string | undefined {
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => STACK_FRAME.test(line))
    .slice(0, MAX_STACK_FRAMES);
  return frames.length === 0 ? undefined : frames.join("\n");
}

export const FIELDS = {
  sessionId: matching("questionnaire.session_id", IDENTIFIER, false),
  questionnaireId: matching("questionnaire.id", IDENTIFIER, false),
  questionnaireVersion: quantity("questionnaire.version"),
  itemId: matching("questionnaire.item_id", IDENTIFIER, false),
  lastItemId: matching("questionnaire.last_item_id", IDENTIFIER, false),
  questionId: matching("questionnaire.question_id", IDENTIFIER, false),
  questionType: oneOf("questionnaire.question_type", RESPONSE_TYPES),
  outcome: oneOf("questionnaire.outcome", OUTCOMES),
  reason: oneOf("questionnaire.reason", SUBMISSION_ITEM_CODES),
  elapsedSeconds: quantity("questionnaire.elapsed_seconds"),
  durationMs: quantity("questionnaire.duration_ms"),
  questionCount: quantity("questionnaire.question_count"),
  requestId: matching("http.request.id", IDENTIFIER, false),
  method: oneOf("http.request.method", HTTP_METHODS),
  route: matching("http.route", ROUTE, true),
  status: statusCode("http.response.status_code"),
  responseTimeMs: quantity("http.server.request.duration_ms"),
  errorType: matching("error.type", TYPE_NAME, true),
  errorCode: matching("error.code", ERROR_CODE, true),
  errorStack: { attribute: "error.stack", bounded: false, accepts: isStackTrace },
  signal: oneOf("process.signal", SIGNALS),
} as const satisfies Record<string, FieldDefinition<unknown>>;

export type FieldName = keyof typeof FIELDS;

export type FieldValue<K extends FieldName> = (typeof FIELDS)[K] extends FieldDefinition<infer V> ? V : never;

type CallerFieldName = Exclude<FieldName, "errorStack">;

export type TelemetryContext = { readonly [K in CallerFieldName]?: FieldValue<K> | null };

export function isFieldName(key: string): key is FieldName {
  return Object.hasOwn(FIELDS, key);
}

const FIELD_ATTRIBUTES: ReadonlyMap<string, FieldDefinition<unknown>> = new Map(
  Object.values(FIELDS).map((definition): [string, FieldDefinition<unknown>] => [definition.attribute, definition]),
);

const INFRASTRUCTURE: ReadonlyMap<string, FieldDefinition<unknown>> = new Map<string, FieldDefinition<unknown>>([
  ["trace_id", matching("trace_id", /^[0-9a-f]{32}$/, false)],
  ["span_id", matching("span_id", /^[0-9a-f]{16}$/, false)],
  ["module", matching("module", /^[a-z][a-z0-9_-]{0,63}$/, true)],
  ["exception.type", matching("exception.type", TYPE_NAME, true)],
  ["otel.status_code", oneOf("otel.status_code", ["OK", "ERROR"])],
  ["telemetry.signal", oneOf("telemetry.signal", ["log", "span", "metric"])],
  ["telemetry.reason", oneOf("telemetry.reason", ["unknown", "invalid", "unbounded"])],
  ["db.system", matching("db.system", /^[a-z][a-z0-9_.]{0,31}$/, true)],
  ["db.system.name", matching("db.system.name", /^[a-z][a-z0-9_.]{0,31}$/, true)],
  ["db.operation", matching("db.operation", /^[A-Za-z_]{1,32}$/, true)],
  ["db.operation.name", matching("db.operation.name", /^[A-Za-z_]{1,32}$/, true)],
  ["db.sql.table", matching("db.sql.table", /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/, true)],
  ["db.name", matching("db.name", IDENTIFIER, true)],
  ["db.namespace", matching("db.namespace", IDENTIFIER, true)],
  ["server.address", matching("server.address", /^[A-Za-z0-9_.-]{1,255}$/, true)],
  ["server.port", portNumber("server.port")],
  ["net.peer.name", matching("net.peer.name", /^[A-Za-z0-9_.-]{1,255}$/, true)],
  ["net.peer.port", portNumber("net.peer.port")],
  ["fastify.type", matching("fastify.type", /^[a-z][a-z-]{0,31}$/, true)],
  ["fastify.root", matching("fastify.root", /^@[a-z]+\/[a-z]+$/, true)],
]);

function portNumber(attribute: string): FieldDefinition<number> {
  return {
    attribute,
    bounded: true,
    accepts: (value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536,
  };
}

export function definitionOfAttribute(attribute: string): FieldDefinition<unknown> | undefined {
  return FIELD_ATTRIBUTES.get(attribute) ?? INFRASTRUCTURE.get(attribute);
}
