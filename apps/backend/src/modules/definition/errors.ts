import { problem } from "@qp/shared";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { databaseErrorOf, QUESTION_VERSION_PRIMARY_KEY, SQLSTATE } from "../../db/errors.js";
import { replyWithProblem, sendProblem } from "../../http/problems.js";

export function replyWithDefinitionProblem(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const databaseError = databaseErrorOf(error);
  if (databaseError?.code === SQLSTATE.immutable) {
    return sendProblem(reply, problem("version/immutable"));
  }
  if (databaseError?.code === SQLSTATE.uniqueViolation && databaseError.constraint === QUESTION_VERSION_PRIMARY_KEY) {
    return sendProblem(reply, problem("question/version-conflict"));
  }
  return replyWithProblem(error, request, reply);
}
