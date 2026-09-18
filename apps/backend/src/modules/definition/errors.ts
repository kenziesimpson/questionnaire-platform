import { problem } from "@qp/shared";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { databaseErrorOf } from "../../http/database-errors.js";
import { replyWithProblem, sendProblem } from "../../http/problems.js";

const IMMUTABLE_ROW = "QP001";
const UNIQUE_VIOLATION = "23505";
const QUESTION_VERSION_PRIMARY_KEY = "question_version_pkey";

export function replyWithDefinitionProblem(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const databaseError = databaseErrorOf(error);
  if (databaseError?.code === IMMUTABLE_ROW) {
    return sendProblem(reply, problem("version/immutable", { instance: request.url }));
  }
  if (databaseError?.code === UNIQUE_VIOLATION && databaseError.constraint === QUESTION_VERSION_PRIMARY_KEY) {
    return sendProblem(reply, problem("question/version-conflict", { instance: request.url }));
  }
  return replyWithProblem(error, request, reply);
}
