import {
  PROBLEM_CONTENT_TYPE,
  formatDraftEtag,
  problem,
  type DraftItem,
  type ProblemInit,
  type ProblemSlug,
  type QuestionnaireDraft,
} from "@qp/shared";
import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";

export const QUESTIONNAIRE_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";
export const VERSION_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c1";
export const QUESTION_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c2";

export const etagAt = (revision: number) => formatDraftEtag(VERSION_ID, revision);

export function anItem(itemId: string): DraftItem {
  return { itemId, required: true, visibleWhen: null, questionId: QUESTION_ID, questionVersion: 1 };
}

export function aDraft(itemIds: string[] = ["itm_01", "itm_02"]): QuestionnaireDraft {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    versionId: VERSION_ID,
    title: "Patient Intake",
    updatedAt: "2026-09-14T09:00:00.000Z",
    items: itemIds.map(anItem),
    questions: [],
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function draftResponse(draft: QuestionnaireDraft, revision: number, status = 200): Response {
  return jsonResponse(status, draft, { etag: etagAt(revision) });
}

export function problemResponse<S extends ProblemSlug>(
  slug: S,
  ...init: {} extends ProblemInit<S> ? [ProblemInit<S>?] : [ProblemInit<S>]
): Response {
  const body = problem(slug, ...init);
  return new Response(JSON.stringify(body), { status: body.status, headers: { "content-type": PROBLEM_CONTENT_TYPE } });
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

export type FetchHandler = (request: RecordedRequest) => Response | Promise<Response>;

export function stubFetch(handler: FetchHandler) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const request = { method: init?.method ?? "GET", url: String(input), headers: new Headers(init?.headers), body };
    requests.push(request);
    return handler(request);
  });
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

export function respondInOrder(...responses: Response[]): FetchHandler {
  return () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("fetch was called more often than the test expected");
    return next;
  };
}

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
