import AjvCompiler from "@fastify/ajv-compiler";
import { PROBLEM_CONTENT_TYPE, problem, type PointerError, type Problem } from "@qp/shared";
import type {
  FastifyError,
  FastifyReply,
  FastifyRequest,
  FastifySchemaCompiler,
  FastifySchemaValidationError,
} from "fastify";

export function sendProblem(reply: FastifyReply, body: Problem): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

const buildAjvCompiler = AjvCompiler();

export function exactValidatorCompiler(): FastifySchemaCompiler<unknown> {
  const compile = buildAjvCompiler({}, { customOptions: { coerceTypes: false, removeAdditional: false } }) as unknown as FastifySchemaCompiler<unknown>;
  return (route) => compile(route);
}

function namedProperty(error: FastifySchemaValidationError): unknown {
  const params = error.params as { missingProperty?: unknown; additionalProperty?: unknown };
  if (error.keyword === "required") return params.missingProperty;
  if (error.keyword === "additionalProperties") return params.additionalProperty;
  return undefined;
}

function pointerOf(part: string, error: FastifySchemaValidationError): string {
  const property = namedProperty(error);
  const suffix = typeof property === "string" ? `/${property.replaceAll("~", "~0").replaceAll("/", "~1")}` : "";
  return `/${part}${error.instancePath}${suffix}`;
}

function isInsideFailedUnion(error: FastifySchemaValidationError, unionPaths: readonly string[]): boolean {
  return (
    error.keyword !== "anyOf" &&
    unionPaths.some((path) => error.instancePath === path || error.instancePath.startsWith(`${path}/`))
  );
}

export function pointerErrors(part: string, validation: readonly FastifySchemaValidationError[]): PointerError[] {
  const unionPaths = validation.filter((error) => error.keyword === "anyOf").map((error) => error.instancePath);
  const unique = new Map<string, PointerError>();
  for (const error of validation) {
    if (isInsideFailedUnion(error, unionPaths)) continue;
    const entry: PointerError = { pointer: pointerOf(part, error), code: `schema/${error.keyword}` };
    unique.set(`${entry.pointer} ${entry.code}`, entry);
  }
  return [...unique.values()];
}

function sqlStateOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function replyWithProblem(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error.validation !== undefined) {
    return sendProblem(reply, problem("request/invalid", { errors: pointerErrors(error.validationContext ?? "body", error.validation) }));
  }
  if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return sendProblem(reply, problem("request/invalid", { errors: [] }));
  }
  request.log.error({ errorName: error.name, errorCode: sqlStateOf(error) }, "unhandled request error");
  return sendProblem(reply, problem("internal", { detail: String(request.id) }));
}

export function replyNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, problem("resource/not-found", { instance: request.url }));
}
