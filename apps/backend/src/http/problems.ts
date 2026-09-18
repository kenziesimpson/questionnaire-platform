import { PROBLEM_CONTENT_TYPE, problem, type Problem } from "@qp/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { databaseErrorOf } from "./database-errors.js";
import { pointerErrors, requestValidatorCompiler } from "./validation.js";

type ProblemErrorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => FastifyReply;

export function sendProblem(reply: FastifyReply, body: Problem): FastifyReply {
  return reply.code(body.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

export function notFoundProblem(instance: string): Problem<"resource/not-found"> {
  return problem("resource/not-found", { instance });
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

function replyNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, notFoundProblem(request.url));
}

export function applyHttpDefaults(scope: FastifyInstance, errorHandler: ProblemErrorHandler): void {
  scope.setValidatorCompiler(requestValidatorCompiler());
  scope.setErrorHandler(errorHandler);
  scope.setNotFoundHandler(replyNotFound);
}
