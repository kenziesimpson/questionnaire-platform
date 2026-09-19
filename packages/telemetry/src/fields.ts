import { PROBLEM_SLUGS, RESPONSE_TYPES, SUBMISSION_ITEM_CODES } from "@qp/shared";
import { PROBLEM_CODES } from "./problems.js";
import { DROP_REASONS, LOG_ATTRIBUTES, SCRUB_ATTRIBUTES, SIGNAL_KINDS } from "./vocabulary.js";

export const OUTCOMES = ["accepted", "rejected_validation", "rejected_conflict", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

const DATABASE_POOLS = ["definition", "execution", "reporting"] as const;

export interface FieldDefinition<V> {
  readonly attribute: string;
  readonly bounded: boolean;
  readonly accepts: (value: unknown) => value is V;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ROUTE = /^\/[A-Za-z0-9_.:*{}/-]{0,200}$/;
const TYPE_NAME = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/;
const ERROR_CODE = /^[A-Za-z0-9_]{1,32}$/;
const INVARIANT_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
const CONSTRAINT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const DB_SYSTEM = /^[a-z][a-z0-9_.]{0,31}$/;
const DB_OPERATION = /^[A-Za-z_]{1,32}$/;
const HOST_NAME = /^[A-Za-z0-9_.-]{1,255}$/;
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
  invariant: matching("error.invariant", INVARIANT_NAME, true),
  constraint: matching("db.constraint", CONSTRAINT_NAME, true),
  problem: oneOf("problem.slug", PROBLEM_SLUGS),
  problemCode: oneOf("problem.code", PROBLEM_CODES),
  pool: oneOf("db.pool", DATABASE_POOLS),
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

function indexedByAttribute(definitions: readonly FieldDefinition<unknown>[]): ReadonlyMap<string, FieldDefinition<unknown>> {
  return new Map(definitions.map((definition) => [definition.attribute, definition]));
}

const FIELD_ATTRIBUTES = indexedByAttribute(Object.values(FIELDS));

const INFRASTRUCTURE = indexedByAttribute([
  matching(LOG_ATTRIBUTES.traceId, /^[0-9a-f]{32}$/, false),
  matching(LOG_ATTRIBUTES.spanId, /^[0-9a-f]{16}$/, false),
  matching(LOG_ATTRIBUTES.module, /^[a-z][a-z0-9_-]{0,63}$/, true),
  matching("exception.type", TYPE_NAME, true),
  oneOf("otel.status_code", ["OK", "ERROR"]),
  oneOf(SCRUB_ATTRIBUTES.signal, SIGNAL_KINDS),
  oneOf(SCRUB_ATTRIBUTES.reason, DROP_REASONS),
  matching("db.system", DB_SYSTEM, true),
  matching("db.system.name", DB_SYSTEM, true),
  matching("db.operation", DB_OPERATION, true),
  matching("db.operation.name", DB_OPERATION, true),
  matching("db.sql.table", /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/, true),
  matching("db.name", IDENTIFIER, true),
  matching("db.namespace", IDENTIFIER, true),
  matching("server.address", HOST_NAME, true),
  portNumber("server.port"),
  matching("net.peer.name", HOST_NAME, true),
  portNumber("net.peer.port"),
  matching("fastify.type", /^[a-z][a-z-]{0,31}$/, true),
  matching("fastify.root", /^@[a-z]+\/[a-z]+$/, true),
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
