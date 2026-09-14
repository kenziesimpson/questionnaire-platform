import { definitionApi, problem, validateQuestionRules, type Problem, type QuestionInput } from "@qp/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  appendQuestionVersion,
  archiveQuestion,
  createQuestion,
  findQuestion,
  findQuestionVersion,
  listQuestions,
  listQuestionUsage,
  listQuestionVersionSummaries,
} from "../../../db/definition/questions.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import type { DefinitionModuleOptions } from "../plugin.js";

function notFound(request: FastifyRequest): Problem {
  return problem("resource/not-found", { instance: request.url });
}

function questionRuleProblem(content: QuestionInput): Problem | undefined {
  const failures = validateQuestionRules(content);
  if (failures.length === 0) {
    return undefined;
  }
  return problem("request/invalid", {
    errors: failures.map((failure) => ({ pointer: `/body/question${failure.pointer}`, code: failure.code })),
  });
}

export async function questionRoutes(scope: FastifyInstance, { database }: DefinitionModuleOptions): Promise<void> {
  registerRoute(scope, definitionApi.listQuestions, async (request) => ({
    status: 200,
    body: await listQuestions(database, { includeArchived: request.query.includeArchived ?? false }),
  }));

  registerRoute(scope, definitionApi.createQuestion, async (request) => {
    const invalid = questionRuleProblem(request.body.question);
    if (invalid !== undefined) {
      return invalid;
    }
    const saved = await createQuestion(database, {
      key: request.body.key ?? null,
      content: request.body.question,
      createdBy: authorOf(request),
      traceId: null,
    });
    const created = await findQuestion(database, saved.questionId);
    if (created === undefined) {
      throw new Error(`question ${saved.questionId} was not readable after it was created`);
    }
    return { status: 201, body: created };
  });

  registerRoute(scope, definitionApi.getQuestion, async (request) => {
    const found = await findQuestion(database, request.params.questionId);
    return found === undefined ? notFound(request) : { status: 200, body: found };
  });

  registerRoute(scope, definitionApi.listQuestionVersions, async (request) => {
    const versions = await listQuestionVersionSummaries(database, request.params.questionId);
    return versions === undefined ? notFound(request) : { status: 200, body: versions };
  });

  registerRoute(scope, definitionApi.getQuestionVersion, async (request) => {
    const found = await findQuestionVersion(database, request.params.questionId, request.params.v);
    return found === undefined ? notFound(request) : { status: 200, body: found };
  });

  registerRoute(scope, definitionApi.createQuestionVersion, async (request) => {
    const invalid = questionRuleProblem(request.body.question);
    if (invalid !== undefined) {
      return invalid;
    }
    const appended = await appendQuestionVersion(database, {
      questionId: request.params.questionId,
      content: request.body.question,
      createdBy: authorOf(request),
      traceId: null,
    });
    if (appended.outcome === "not-found") {
      return notFound(request);
    }
    const saved = await findQuestionVersion(database, appended.questionId, appended.questionVersion);
    if (saved === undefined) {
      throw new Error(`version ${appended.questionVersion} of question ${appended.questionId} was not readable after it was saved`);
    }
    return { status: 201, body: saved };
  });

  registerRoute(scope, definitionApi.archiveQuestion, async (request) => {
    const archived = await archiveQuestion(database, {
      questionId: request.params.questionId,
      actorId: authorOf(request),
      traceId: null,
    });
    return archived.outcome === "not-found" ? notFound(request) : { status: 200, body: archived.question };
  });

  registerRoute(scope, definitionApi.getQuestionUsage, async (request) => {
    const usage = await listQuestionUsage(database, request.params.questionId);
    return usage === undefined ? notFound(request) : { status: 200, body: usage };
  });
}
