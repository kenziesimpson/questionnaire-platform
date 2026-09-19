import { PROBLEM_SLUGS, RESPONSE_TYPES, SLUG_PATTERN, SUBMISSION_ITEM_CODES, UUID_PATTERN } from "@qp/shared";
import { PROBLEM_CODES } from "./problems.js";
import {
  DROP_REASONS,
  EVENT_SOURCES,
  INGEST_DROP_REASONS,
  LOG_ATTRIBUTES,
  LOG_MODULES,
  SCRUB_ATTRIBUTES,
  SIGNAL_KINDS,
} from "./vocabulary.js";

export const OUTCOMES = ["accepted", "replayed", "rejected_validation", "rejected_conflict", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

const DATABASE_POOLS = ["definition", "execution", "reporting"] as const;

export interface FieldDefinition<V> {
  readonly attribute: string;
  readonly bounded: boolean;
  readonly accepts: (value: unknown) => value is V;
}

const UUID = new RegExp(UUID_PATTERN);
const SLUG = new RegExp(SLUG_PATTERN);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ROUTE_LITERAL = "[a-z0-9][a-z0-9_.-]*";
const ROUTE_PARAMETER = "(?::[A-Za-z_][A-Za-z0-9_]*|\\$[A-Za-z_][A-Za-z0-9_]*|\\{[A-Za-z_][A-Za-z0-9_]*\\}|\\*)";
const ROUTE = new RegExp(`^(?=.{1,200}$)(?:/|(?:/(?:${ROUTE_LITERAL}|${ROUTE_PARAMETER}))+/?)$`);
const ERROR_CLASS_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
const EXCEPTION_TYPE = /^(?:[A-Z][A-Za-z0-9]{0,63}|(?:FST_)?ERR_[A-Z0-9_]{1,63}|[0-9A-Z]{5})$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const INVARIANT_NAME = /^(?=.{1,64}$)[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const CONSTRAINT_NAME = /^(?=.{1,63}$)[a-z][a-z0-9]*(?:_+[a-z0-9]+)+$/;
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
  const lines = value.split("\n");
  return lines.length <= MAX_STACK_FRAMES && frameLines(lines).length === lines.length;
}

function frameLines(lines: readonly string[]): string[] {
  return lines.filter((line) => STACK_FRAME.test(line)).slice(0, MAX_STACK_FRAMES);
}

export function stackFramesOf(error: Error): string | undefined {
  const lines = (error.stack ?? "").split("\n");
  const headerLines = error.message.split("\n").length;
  if (!lines.slice(0, headerLines).join("\n").endsWith(error.message)) return undefined;
  const frames = frameLines(lines.slice(headerLines));
  return frames.length === 0 ? undefined : frames.join("\n");
}

export const FIELDS = {
  sessionId: matching("questionnaire.session_id", UUID, false),
  questionnaireId: matching("questionnaire.id", UUID, false),
  questionnaireVersionId: matching("questionnaire.version_id", UUID, false),
  questionnaireVersion: quantity("questionnaire.version"),
  itemId: matching("questionnaire.item_id", SLUG, false),
  lastItemId: matching("questionnaire.last_item_id", SLUG, false),
  questionId: matching("questionnaire.question_id", UUID, false),
  questionType: oneOf("questionnaire.question_type", RESPONSE_TYPES),
  outcome: oneOf("questionnaire.outcome", OUTCOMES),
  reason: oneOf("questionnaire.reason", SUBMISSION_ITEM_CODES),
  elapsedSeconds: quantity("questionnaire.elapsed_seconds"),
  durationMs: quantity("questionnaire.duration_ms"),
  questionCount: quantity("questionnaire.question_count"),
  requestId: matching("http.request.id", UUID, false),
  method: oneOf("http.request.method", HTTP_METHODS),
  route: matching("http.route", ROUTE, true),
  status: statusCode("http.response.status_code"),
  responseTimeMs: quantity("http.server.request.duration_ms"),
  errorType: matching("error.type", ERROR_CLASS_NAME, true),
  errorCode: matching("error.code", SQLSTATE, true),
  invariant: matching("error.invariant", INVARIANT_NAME, true),
  constraint: matching("db.constraint", CONSTRAINT_NAME, true),
  problem: oneOf("problem.slug", PROBLEM_SLUGS),
  problemCode: oneOf("problem.code", PROBLEM_CODES),
  pool: oneOf("db.pool", DATABASE_POOLS),
  errorStack: { attribute: "error.stack", bounded: false, accepts: isStackTrace },
  signal: oneOf("process.signal", SIGNALS),
  source: oneOf("telemetry.source", EVENT_SOURCES),
  eventAgeMs: quantity("telemetry.event_age_ms"),
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
  oneOf(LOG_ATTRIBUTES.module, LOG_MODULES),
  matching("exception.type", EXCEPTION_TYPE, true),
  oneOf("otel.status_code", ["OK", "ERROR"]),
  oneOf(SCRUB_ATTRIBUTES.signal, SIGNAL_KINDS),
  oneOf(SCRUB_ATTRIBUTES.reason, DROP_REASONS),
  oneOf(SCRUB_ATTRIBUTES.ingestReason, INGEST_DROP_REASONS),
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
