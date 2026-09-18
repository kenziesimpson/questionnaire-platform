import type { APIRequestContext } from "@playwright/test";
import { executionApi, type ClientAnswers, type ReplyOf, type RouteDefinition } from "@qp/shared";
import { expectBody, sendRouteRequest, type ApiExchange, type ApiRequestParts } from "./api-exchange";

export type StartedSession = ReplyOf<typeof executionApi.createSession, 201>;
export type ResumedSession = ReplyOf<typeof executionApi.getSession, 200>;
export type SubmitReply = ReplyOf<typeof executionApi.submitSession, 200>;

export class ExecutionApi {
  readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  send(route: RouteDefinition, parts: ApiRequestParts = {}): Promise<ApiExchange> {
    return sendRouteRequest(this.request, executionApi.EXECUTION_PREFIX, route, parts);
  }

  async createSession(questionnaireId: string): Promise<StartedSession> {
    const route = executionApi.createSession;
    return expectBody(await this.send(route, { body: { questionnaireId } }), 201, route.schema.response[201]);
  }

  async getSession(sessionId: string): Promise<ResumedSession> {
    const route = executionApi.getSession;
    return expectBody(await this.send(route, { params: { sessionId } }), 200, route.schema.response[200]);
  }

  async submit(sessionId: string, answers: ClientAnswers): Promise<SubmitReply> {
    const route = executionApi.submitSession;
    return expectBody(await this.sendSubmit(sessionId, answers), 200, route.schema.response[200]);
  }

  sendSubmit(sessionId: string, answers: ClientAnswers): Promise<ApiExchange> {
    return this.send(executionApi.submitSession, { params: { sessionId }, body: { answers } });
  }
}
