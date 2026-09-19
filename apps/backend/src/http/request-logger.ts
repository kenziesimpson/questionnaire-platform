import { FIELDS, logger, type LogLevel, type TelemetryContext } from "@qp/telemetry";
import type { FastifyBaseLogger } from "fastify";

const http = logger("http");

const KNOWN_MESSAGES = ["incoming request", "request completed", "unhandled request error"] as const;

const FALLBACK_MESSAGE = "fastify log";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function accepted<V>(definition: { readonly accepts: (value: unknown) => value is V }, value: unknown): V | undefined {
  return definition.accepts(value) ? value : undefined;
}

function messageOf(text: unknown): (typeof KNOWN_MESSAGES)[number] | typeof FALLBACK_MESSAGE {
  return KNOWN_MESSAGES.find((known) => known === text) ?? FALLBACK_MESSAGE;
}

function contextOf(fields: Record<string, unknown>): TelemetryContext {
  const res = isRecord(fields.res) ? fields.res : {};
  const req = isRecord(fields.req) ? fields.req : isRecord(res.request) ? res.request : {};
  const routeOptions = isRecord(req.routeOptions) ? req.routeOptions : {};
  return {
    method: accepted(FIELDS.method, req.method),
    route: accepted(FIELDS.route, routeOptions.url),
    status: accepted(FIELDS.status, res.statusCode),
    responseTimeMs: typeof fields.responseTime === "number" ? fields.responseTime : undefined,
    errorType: accepted(FIELDS.errorType, fields.errorName),
    errorCode: accepted(FIELDS.errorCode, fields.errorCode),
  };
}

function write(level: LogLevel, inherited: TelemetryContext) {
  return (first: unknown, second?: unknown): void => {
    const fields = isRecord(first) ? first : {};
    const error = first instanceof Error ? first : fields.err instanceof Error ? fields.err : undefined;
    const message = messageOf(typeof first === "string" ? first : second);
    http[level](message, { ...inherited, ...contextOf(fields) }, error);
  };
}

export function requestLogger(level: LogLevel, inherited: TelemetryContext = {}): FastifyBaseLogger {
  return {
    level,
    trace: write("debug", inherited),
    debug: write("debug", inherited),
    info: write("info", inherited),
    warn: write("warn", inherited),
    error: write("error", inherited),
    fatal: write("error", inherited),
    silent: () => undefined,
    child: (bindings) => requestLogger(level, { ...inherited, requestId: accepted(FIELDS.requestId, bindings.reqId) }),
  };
}
