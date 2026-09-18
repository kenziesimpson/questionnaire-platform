import type { Page, Request, Response } from "@playwright/test";
import { executionApi } from "@qp/shared";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import {
  matchesExecutionRoute,
  problemReplyOf as replyOf,
  recordRequests,
  waitForExecutionResponse,
  type ProblemReply,
} from "../../../fixtures/index.ts";

export const SUBMIT_URL_GLOB = `**${executionApi.EXECUTION_PREFIX}${executionApi.submitSession.url.replace(":sessionId", "*")}`;

export const SubmitBody = executionApi.submitSession.schema.body;
export type SubmitBody = Static<typeof SubmitBody>;

export const SubmitReceiptBody = executionApi.submitSession.schema.response[200];
export type SubmitReceiptBody = Static<typeof SubmitReceiptBody>;

function isSubmitRequest(request: Request): boolean {
  return matchesExecutionRoute(request, executionApi.submitSession);
}

export function isCreateSessionRequest(request: Request): boolean {
  return matchesExecutionRoute(request, executionApi.createSession);
}

export function isGetSessionRequest(request: Request, sessionId: string): boolean {
  return matchesExecutionRoute(request, executionApi.getSession, { sessionId });
}

export function recordSubmitRequests(page: Page): Request[] {
  return recordRequests(page, isSubmitRequest);
}

export function waitForSubmitResponse(page: Page): Promise<Response> {
  return waitForExecutionResponse(page, executionApi.submitSession);
}

function parsedJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function submitBodyOf(request: Request): SubmitBody {
  const body = parsedJson(request.postData());
  if (!Value.Check(SubmitBody, body)) throw new Error(`The submit request carried a body outside its contract: ${request.postData()}`);
  return body;
}

export async function receiptBodyOf(response: Response): Promise<SubmitReceiptBody> {
  const body = parsedJson(await response.text());
  if (!Value.Check(SubmitReceiptBody, body)) throw new Error(`The submit response carried a body outside its contract: ${JSON.stringify(body)}`);
  return body;
}

export interface SubmitProblemReply extends ProblemReply {
  readonly raw: string;
}

export async function problemReplyOf(response: Response): Promise<SubmitProblemReply> {
  const raw = await response.text();
  const reply = replyOf(response.status(), parsedJson(raw));
  if (reply.problem === undefined) throw new Error(`Expected a problem details body, got ${raw}`);
  return { ...reply, raw };
}
