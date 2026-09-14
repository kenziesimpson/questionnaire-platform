import { executionApi, problem, sensitive, type BodyOf, type ParamsOf } from "@qp/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../../db/client.js";
import { exactValidatorCompiler, replyNotFound, replyWithProblem, sendProblem } from "../../http/problems.js";
import { PublishedDefinitions } from "./published-definitions.js";
import { resumeSession, sessionView, startSession, type SessionWithDefinitionOutcome } from "./sessions.js";
import { submitSession } from "./submit.js";

export type Clock = () => Date;

export interface ExecutionModuleOptions {
  readonly database: Database;
  readonly clock?: Clock;
}

const { createSession, getSession, submitSession: submitSessionRoute } = executionApi;

function replyWithSession(
  request: FastifyRequest,
  reply: FastifyReply,
  result: SessionWithDefinitionOutcome,
  successStatus: 200 | 201,
): FastifyReply {
  switch (result.outcome) {
    case "not-found":
      return replyNotFound(request, reply);
    case "closed":
      return sendProblem(reply, problem("questionnaire/closed", { instance: request.url }));
    case "found":
      return reply.code(successStatus).send({ session: sessionView(result.session), definition: result.definition });
  }
}

export async function executionModule(scope: FastifyInstance, options: ExecutionModuleOptions): Promise<void> {
  const { database } = options;
  const clock = options.clock ?? (() => new Date());
  const definitions = new PublishedDefinitions();

  scope.setValidatorCompiler(exactValidatorCompiler());
  scope.setErrorHandler(replyWithProblem);
  scope.setNotFoundHandler(replyNotFound);
  scope.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  scope.route<{ Body: BodyOf<typeof createSession> }>({
    ...createSession,
    handler: async (request, reply) =>
      replyWithSession(request, reply, await startSession(database, definitions, request.body.questionnaireId, clock()), 201),
  });

  scope.route<{ Params: ParamsOf<typeof getSession> }>({
    ...getSession,
    handler: async (request, reply) =>
      replyWithSession(request, reply, await resumeSession(database, definitions, request.params.sessionId, clock()), 200),
  });

  scope.route<{ Params: ParamsOf<typeof submitSessionRoute>; Body: BodyOf<typeof submitSessionRoute> }>({
    ...submitSessionRoute,
    handler: async (request, reply) => {
      const result = await submitSession(database, definitions, {
        sessionId: request.params.sessionId,
        answers: sensitive(request.body.answers),
        now: clock(),
      });
      switch (result.outcome) {
        case "submitted":
        case "replayed":
          return reply.code(200).send({ receipt: result.receipt });
        case "not-found":
          return replyNotFound(request, reply);
        case "closed":
          return sendProblem(reply, problem("questionnaire/closed", { instance: request.url }));
        case "already-submitted":
          return sendProblem(reply, problem("session/already-submitted", { instance: request.url }));
        case "invalid":
          return sendProblem(reply, problem("submission/invalid", { instance: request.url, items: [...result.items] }));
      }
    },
  });
}
