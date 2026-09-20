import { PROBLEM_CONTENT_TYPE, problem, type Problem } from "@qp/shared";
import { activeTraceId, annotateActiveSpan, logger, problemTelemetry, type TelemetryContext } from "@qp/telemetry";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { databaseErrorOf } from "../db/errors.js";
import { InvariantViolation } from "../invariant.js";
import { requestContextOf } from "./request-logger.js";
import { pointerErrors, requestValidatorCompiler } from "./validation.js";

type ProblemErrorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => FastifyReply;

const log = logger("http");

function logProblem(request: FastifyRequest, body: Problem): void {
  const level = body.status >= 500 ? "error" : "info";
  for (const fields of problemTelemetry(body)) {
    log[level]("problem response", { ...requestContextOf(request), ...fields });
  }
}

export function sendProblem(reply: FastifyReply, body: Problem): FastifyReply {
  logProblem(reply.request, body);
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send({ ...body, instance: reply.request.url });
}

export function notFoundProblem(): Problem<"resource/not-found"> {
  return problem("resource/not-found");
}

export function replyWithProblem(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error.validation !== undefined) {
    return sendProblem(reply, problem("request/invalid", { errors: pointerErrors(error.validationContext ?? "body", error.validation) }));
  }
  if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return sendProblem(reply, problem("request/invalid", { errors: [] }));
  }
  reportUnhandled(request, error);
  return sendProblem(reply, problem("internal", { detail: activeTraceId() ?? String(request.id) }));
}

function failureContextOf(error: Error): TelemetryContext {
  const database = databaseErrorOf(error);
  return {
    errorCode: database?.code,
    constraint: database?.constraint,
    ...(error instanceof InvariantViolation ? { invariant: error.invariant, ...error.ids } : {}),
  };
}

function reportUnhandled(request: FastifyRequest, error: Error): void {
  const failure = failureContextOf(error);
  annotateActiveSpan(failure, error);
  log.error("unhandled request error", { ...requestContextOf(request), ...failure }, error);
}

function replyNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, notFoundProblem());
}

export function applyHttpDefaults(scope: FastifyInstance, errorHandler: ProblemErrorHandler): void {
  scope.setValidatorCompiler(requestValidatorCompiler());
  scope.setErrorHandler(errorHandler);
  scope.setNotFoundHandler(replyNotFound);
}
