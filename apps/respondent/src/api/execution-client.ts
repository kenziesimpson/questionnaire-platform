import { executionApi, routePath, type BodyOf, type ClientAnswers, type ParamsOf, type ReplyOf, type Sensitive } from "@qp/shared";
import type { ExecutionProblemSlug } from "./problems";
import { sendExecutionRequest, type ExecutionOutcome } from "./request";

const { createSession: createRoute, getSession: getRoute, submitSession: submitRoute } = executionApi;

export const CREATE_SESSION_PROBLEMS = [
  "request/invalid",
  "resource/not-found",
  "questionnaire/closed",
  "internal",
] as const satisfies readonly ExecutionProblemSlug[];

export const GET_SESSION_PROBLEMS = [
  "request/invalid",
  "resource/not-found",
  "questionnaire/closed",
  "internal",
] as const satisfies readonly ExecutionProblemSlug[];

export const SUBMIT_SESSION_PROBLEMS = [
  "request/invalid",
  "resource/not-found",
  "questionnaire/closed",
  "session/already-submitted",
  "submission/invalid",
  "internal",
] as const satisfies readonly ExecutionProblemSlug[];

export type CreateSessionOutcome = ExecutionOutcome<
  ReplyOf<typeof createRoute, 201>,
  (typeof CREATE_SESSION_PROBLEMS)[number]
>;

export type GetSessionOutcome = ExecutionOutcome<ReplyOf<typeof getRoute, 200>, (typeof GET_SESSION_PROBLEMS)[number]>;

export type SubmitSessionOutcome = ExecutionOutcome<
  ReplyOf<typeof submitRoute, 200>,
  (typeof SUBMIT_SESSION_PROBLEMS)[number]
>;

export function createSession(questionnaireId: string): Promise<CreateSessionOutcome> {
  const body: BodyOf<typeof createRoute> = { questionnaireId };
  return sendExecutionRequest({
    method: createRoute.method,
    route: createRoute.url,
    path: createRoute.url,
    body: JSON.stringify(body),
    success: { status: 201, schema: createRoute.schema.response[201] },
    problems: CREATE_SESSION_PROBLEMS,
  });
}

export function getSession(sessionId: string): Promise<GetSessionOutcome> {
  const params: ParamsOf<typeof getRoute> = { sessionId };
  return sendExecutionRequest({
    method: getRoute.method,
    route: getRoute.url,
    path: routePath(getRoute.url, params),
    success: { status: 200, schema: getRoute.schema.response[200] },
    problems: GET_SESSION_PROBLEMS,
  });
}

export function submitSession(sessionId: string, answers: Sensitive<ClientAnswers>): Promise<SubmitSessionOutcome> {
  const params: ParamsOf<typeof submitRoute> = { sessionId };
  const body: BodyOf<typeof submitRoute> = { answers: answers.unwrap() };
  return sendExecutionRequest({
    method: submitRoute.method,
    route: submitRoute.url,
    path: routePath(submitRoute.url, params),
    body: JSON.stringify(body),
    success: { status: 200, schema: submitRoute.schema.response[200] },
    problems: SUBMIT_SESSION_PROBLEMS,
  });
}
