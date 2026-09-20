import { definitionApi, problem, validateQuestionRules, type Problem, type QuestionInput } from "@qp/shared";
import { activeTraceId } from "@qp/telemetry";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../db/client.js";
import {
  listQuestionUsage,
  listQuestionVersionSummaries,
  listQuestions,
  readQuestion,
  readQuestionVersion,
} from "../../../db/definition/question-reads.js";
import { appendQuestionVersion, archiveQuestion, createQuestion } from "../../../db/definition/questions.js";
import { notFoundProblem } from "../../../http/problems.js";
import { registerRoute } from "../../../http/routes.js";
import { authorOf } from "../author.js";
import { definitionProblem } from "../problems.js";

function questionRuleProblem(content: QuestionInput): Problem | undefined {
  const failures = validateQuestionRules(content);
  if (failures.length === 0) {
    return undefined;
  }
  return problem("request/invalid", {
    errors: failures.map((failure) => ({ pointer: `/body/question${failure.pointer}`, code: failure.code })),
  });
}

export function registerQuestionRoutes(scope: FastifyInstance, database: Database): void {
  registerRoute(scope, definitionApi.listQuestions, async (request) => ({
    status: 200,
    body: await listQuestions(database, { includeArchived: request.query.includeArchived ?? false }),
  }));

  registerRoute(scope, definitionApi.createQuestion, async (request) => {
    const invalid = questionRuleProblem(request.body.question);
    if (invalid !== undefined) {
      return invalid;
    }
    const created = await createQuestion(database, {
      key: request.body.key ?? null,
      content: request.body.question,
      createdBy: authorOf(request),
      traceId: activeTraceId(),
    });
    return { status: 201, body: created.question };
  });

  registerRoute(scope, definitionApi.getQuestion, async (request) => {
    const found = await readQuestion(database, request.params.questionId);
    return found === undefined ? notFoundProblem() : { status: 200, body: found };
  });

  registerRoute(scope, definitionApi.listQuestionVersions, async (request) => {
    const versions = await listQuestionVersionSummaries(database, request.params.questionId);
    return versions === undefined ? notFoundProblem() : { status: 200, body: versions };
  });

  registerRoute(scope, definitionApi.getQuestionVersion, async (request) => {
    const found = await readQuestionVersion(database, request.params.questionId, request.params.v);
    return found === undefined ? notFoundProblem() : { status: 200, body: found };
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
      traceId: activeTraceId(),
    });
    if (appended.outcome !== "saved") {
      return definitionProblem(appended);
    }
    return { status: 201, body: appended.question.latest };
  });

  registerRoute(scope, definitionApi.archiveQuestion, async (request) => {
    const archived = await archiveQuestion(database, {
      questionId: request.params.questionId,
      actorId: authorOf(request),
      traceId: activeTraceId(),
    });
    if (archived.outcome === "question-not-found") {
      return definitionProblem(archived);
    }
    return { status: 200, body: archived.question };
  });

  registerRoute(scope, definitionApi.getQuestionUsage, async (request) => {
    const usage = await listQuestionUsage(database, request.params.questionId);
    return usage === undefined ? notFoundProblem() : { status: 200, body: usage };
  });
}
