import AjvCompiler from "@fastify/ajv-compiler";
import { PROBLEM_CONTENT_TYPE, problem, type PointerError, type Problem } from "@qp/shared";
import type {
  FastifyError,
  FastifyReply,
  FastifyRequest,
  FastifySchemaCompiler,
  FastifySchemaValidationError,
} from "fastify";
import { databaseErrorOf } from "./database-errors.js";

export function sendProblem(reply: FastifyReply, body: Problem): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

const URL_PARTS: ReadonlySet<string> = new Set(["params", "querystring"]);

function ajvSchemaCompiler(coerceTypes: boolean): FastifySchemaCompiler<unknown> {
  const buildAjvCompiler = AjvCompiler();
  // eslint-disable-next-line no-restricted-syntax -- @fastify/ajv-compiler's .d.ts types the compiled function as (schema) => validate, but at runtime it receives Fastify's route definition and reads .schema from it
  return buildAjvCompiler({}, { customOptions: { coerceTypes, removeAdditional: false } }) as unknown as FastifySchemaCompiler<unknown>;
}

export function requestValidatorCompiler(): FastifySchemaCompiler<unknown> {
  const exact = ajvSchemaCompiler(false);
  const coercingUrlStrings = ajvSchemaCompiler(true);
  return (route) => (URL_PARTS.has(route.httpPart ?? "") ? coercingUrlStrings(route) : exact(route));
}

function pointerOf(part: string, error: FastifySchemaValidationError): string {
  const params = error.params as { missingProperty?: unknown; additionalProperty?: unknown };
  const child = error.keyword === "required" ? params.missingProperty : error.keyword === "additionalProperties" ? params.additionalProperty : undefined;
  const suffix = typeof child === "string" ? `/${child.replaceAll("~", "~0").replaceAll("/", "~1")}` : "";
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

export function replyWithProblem(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error.validation !== undefined) {
    return sendProblem(reply, problem("request/invalid", { errors: pointerErrors(error.validationContext ?? "body", error.validation) }));
  }
  if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return sendProblem(reply, problem("request/invalid", { errors: [] }));
  }
  request.log.error({ errorName: error.name, errorCode: databaseErrorOf(error)?.code }, "unhandled request error");
  return sendProblem(reply, problem("internal", { detail: String(request.id) }));
}

export function replyNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, problem("resource/not-found", { instance: request.url }));
}
