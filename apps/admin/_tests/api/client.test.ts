import { definitionApi, problemType, reportingApi, type QuestionUsage, type VersionSummary } from "@qp/shared";
import { startBrowserTracing, stopBrowserTracing } from "@qp/telemetry/browser-tracing";
import { jsonResponse, problemResponse, respondInOrder, stubFetch } from "@qp/ui/testing";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { callDefinition, callReporting, draftApi } from "../../src/api/client";
import { ProblemError, UnexpectedResponseError, isProblem } from "../../src/api/problem-error";
import { QUESTIONNAIRE_ID, QUESTION_ID, aDraft, etagAt } from "../support/builders";
import { draftResponse } from "../support/http";

const spanCalls = vi.hoisted(() => [] as unknown[][]);

vi.mock("@qp/telemetry", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const { withSpan } = original;
  return {
    ...original,
    withSpan: (...args: unknown[]): unknown => {
      spanCalls.push(args);
      return typeof withSpan === "function" ? Reflect.apply(withSpan, undefined, args) : undefined;
    },
  };
});

const aVersionSummary: VersionSummary = {
  questionnaireId: QUESTIONNAIRE_ID,
  version: 2,
  publishedAt: "2026-09-13T09:14:00.000Z",
  publishedBy: null,
  itemCount: 4,
  formatVersion: 1,
};

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("callDefinition", () => {
  it("takes the method and URL from the shared route, fills path parameters and returns the checked body", async () => {
    const usage: QuestionUsage[] = [{ questionnaireId: QUESTIONNAIRE_ID, version: 2, questionVersion: 3 }];
    const requests = stubFetch(respondInOrder(jsonResponse(200, usage)));

    const body = await callDefinition(definitionApi.getQuestionUsage, { params: { questionId: QUESTION_ID } });

    expect(body).toEqual(usage);
    expectTypeOf(body).toEqualTypeOf<QuestionUsage[]>();
    expect(requests).toEqual([
      expect.objectContaining({ method: "GET", url: `/api/definition/questions/${QUESTION_ID}/usage`, body: undefined }),
    ]);
    expect(requests[0]?.headers.get("if-match")).toBeNull();
  });

  it("encodes the query string and sends a JSON body only when the route declares one", async () => {
    const requests = stubFetch(respondInOrder(jsonResponse(200, []), problemResponse("resource/not-found")));

    await callDefinition(definitionApi.listQuestions, { query: { includeArchived: true } });
    await rejectionOf(callDefinition(definitionApi.setClosesAt, { params: { id: QUESTIONNAIRE_ID }, body: { closesAt: null } }));

    expect(requests[0]).toMatchObject({ method: "GET", url: "/api/definition/questions?includeArchived=true" });
    expect(requests[0]?.headers.get("content-type")).toBeNull();
    expect(requests[1]).toMatchObject({
      method: "PUT",
      url: `/api/definition/questionnaires/${QUESTIONNAIRE_ID}/closes-at`,
      body: { closesAt: null },
    });
    expect(requests[1]?.headers.get("content-type")).toBe("application/json");
  });

  it("parses a problem+json 404 into a ProblemError carrying the shared problem", async () => {
    stubFetch(respondInOrder(problemResponse("resource/not-found", { detail: "No such question" })));

    const error = await rejectionOf(callDefinition(definitionApi.getQuestion, { params: { questionId: QUESTION_ID } }));

    expect(error).toBeInstanceOf(ProblemError);
    expect(isProblem(error, "resource/not-found")).toBe(true);
    expect(isProblem(error, "questionnaire/draft-stale")).toBe(false);
    if (!isProblem(error, "resource/not-found")) return;
    expect(error.status).toBe(404);
    expect(error.problem).toEqual({
      type: problemType("resource/not-found"),
      title: "Resource not found",
      status: 404,
      detail: "No such question",
    });
  });

  it("keeps the typed extension members of request/invalid and questionnaire/draft-invalid", async () => {
    stubFetch(
      respondInOrder(
        problemResponse("request/invalid", {
          errors: [
            { pointer: "/body/question/max", code: "question/min-exceeds-max" },
            { pointer: "/body/question", code: "schema/required" },
          ],
        }),
        problemResponse("questionnaire/draft-invalid", { items: [{ itemId: "itm_03", code: "predicate/forward-reference" }] }),
      ),
    );

    const invalidRequest = await rejectionOf(
      callDefinition(definitionApi.archiveQuestion, { params: { questionId: QUESTION_ID } }),
    );
    const invalidDraft = await rejectionOf(draftApi.publish(QUESTIONNAIRE_ID, etagAt(3)));

    expect(isProblem(invalidRequest, "request/invalid") && invalidRequest.problem.errors).toEqual([
      { pointer: "/body/question/max", code: "question/min-exceeds-max" },
      { pointer: "/body/question", code: "schema/required" },
    ]);
    expect(isProblem(invalidDraft, "questionnaire/draft-invalid") && invalidDraft.problem.items).toEqual([
      { itemId: "itm_03", code: "predicate/forward-reference" },
    ]);
  });

  it.each([
    ["an HTML gateway error", new Response("<h1>Bad gateway</h1>", { status: 502, headers: { "content-type": "text/html" } })],
    ["a problem body with a type outside the shared union", jsonResponse(409, { type: "https://example.com/other", title: "x", status: 409 })],
    ["a success body that does not match the route's schema", jsonResponse(200, [{ questionnaireId: "not-a-uuid" }])],
    ["a success status the route does not declare", jsonResponse(201, [])],
  ])("rejects %s as an UnexpectedResponseError", async (_, response) => {
    stubFetch(respondInOrder(response));

    const error = await rejectionOf(callDefinition(definitionApi.listVersions, { params: { id: QUESTIONNAIRE_ID } }));

    expect(error).toBeInstanceOf(UnexpectedResponseError);
  });
});

describe("the draft ETag round trip", () => {
  it("captures the ETag from a draft read and sends it back as If-Match on PUT /draft, then on POST /publish", async () => {
    const draft = aDraft();
    const reordered = aDraft(["itm_02", "itm_01"]);
    const requests = stubFetch(
      respondInOrder(draftResponse(draft, 4), draftResponse(reordered, 5), jsonResponse(201, aVersionSummary)),
    );

    const read = await draftApi.get(QUESTIONNAIRE_ID);
    const saved = await draftApi.replace(QUESTIONNAIRE_ID, { title: reordered.title, items: reordered.items }, read.etag);
    const published = await draftApi.publish(QUESTIONNAIRE_ID, saved.etag);

    expect(read).toEqual({ draft, etag: etagAt(4) });
    expect(saved).toEqual({ draft: reordered, etag: etagAt(5) });
    expect(published).toEqual(aVersionSummary);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET /api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft`,
      `PUT /api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft`,
      `POST /api/definition/questionnaires/${QUESTIONNAIRE_ID}/publish`,
    ]);
    expect(requests.map(({ headers }) => headers.get("if-match"))).toEqual([null, etagAt(4), etagAt(5)]);
    expect(requests[1]?.body).toEqual({ title: reordered.title, items: reordered.items });
  });

  it("captures the ETag when opening the next draft", async () => {
    stubFetch(respondInOrder(draftResponse(aDraft([]), 0, 201)));

    await expect(draftApi.open(QUESTIONNAIRE_ID)).resolves.toEqual({ draft: aDraft([]), etag: etagAt(0) });
  });

  it.each([
    ["no ETag", jsonResponse(200, aDraft())],
    ["an ETag for another draft version", jsonResponse(200, aDraft(), { etag: `W/"${QUESTION_ID}:1"` })],
    ["a strong ETag", jsonResponse(200, aDraft(), { etag: `"${QUESTIONNAIRE_ID}:1"` })],
  ])("refuses a draft read carrying %s, since it could never be written back", async (_, response) => {
    stubFetch(respondInOrder(response));

    await expect(draftApi.get(QUESTIONNAIRE_ID)).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it("keeps the four ETag-carrying draft routes off the generic call, so no caller can drop the ETag", () => {
    const draftRoutesThroughTheGenericCall = () => [
      // @ts-expect-error — a draft read must go through draftApi, which captures the ETag
      callDefinition(definitionApi.getDraft, { params: { id: QUESTIONNAIRE_ID } }),
      // @ts-expect-error — opening a draft must go through draftApi, which captures the ETag
      callDefinition(definitionApi.openDraft, { params: { id: QUESTIONNAIRE_ID } }),
      // @ts-expect-error — a draft write must go through draftApi, which captures the new ETag
      callDefinition(definitionApi.replaceDraft, { params: { id: QUESTIONNAIRE_ID }, body: { title: "T", items: [] }, ifMatch: etagAt(1) }),
      // @ts-expect-error — publish must go through draftApi
      callDefinition(definitionApi.publishDraft, { params: { id: QUESTIONNAIRE_ID }, ifMatch: etagAt(1) }),
    ];
    expect(draftRoutesThroughTheGenericCall).toBeTypeOf("function");
  });
});

describe("trace context", () => {
  afterEach(async () => {
    await stopBrowserTracing();
  });

  const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

  it("sends no traceparent while tracing has not been started", async () => {
    const requests = stubFetch(respondInOrder(jsonResponse(200, [])));

    await callDefinition(definitionApi.listQuestionnaires, {});

    expect(requests[0]?.headers.get("traceparent")).toBeNull();
    expect(requests[0]?.headers.get("accept")).toContain("application/json");
  });

  it("sends one traceparent once tracing is started, beside the headers the call already sent", async () => {
    startBrowserTracing();
    const requests = stubFetch(respondInOrder(draftResponse(aDraft(), 1)));

    await draftApi.replace(QUESTIONNAIRE_ID, { title: "T", items: [] }, etagAt(0));

    const headers = requests[0]?.headers;
    expect(headers?.get("traceparent")).toMatch(TRACEPARENT);
    expect([...(headers?.keys() ?? [])].sort()).toEqual(["accept", "content-type", "if-match", "traceparent"]);
    expect(headers?.get("if-match")).toBe(etagAt(0));
  });

  it("sends a different span for each call, in one trace per call", async () => {
    startBrowserTracing();
    const requests = stubFetch(respondInOrder(jsonResponse(200, []), jsonResponse(200, [])));

    await callDefinition(definitionApi.listQuestionnaires, {});
    await callDefinition(definitionApi.listQuestionnaires, {});

    const [first, second] = requests.map((request) => request.headers.get("traceparent"));
    expect(first).toMatch(TRACEPARENT);
    expect(second).toMatch(TRACEPARENT);
    expect(first).not.toBe(second);
  });

  it("carries no route, url, session id or query in the header, only ids and flags", async () => {
    startBrowserTracing();
    const requests = stubFetch(respondInOrder(jsonResponse(200, [])));

    await callDefinition(definitionApi.listQuestionnaires, {});

    const traceparent = requests[0]?.headers.get("traceparent") ?? "";
    expect(traceparent.split("-")).toHaveLength(4);
    expect(traceparent).not.toMatch(/[/:?=]/);
  });
});

describe("the browser.request span", () => {
  it("names the route by its template, prefix and route url, and never the path it filled", async () => {
    spanCalls.length = 0;
    stubFetch(respondInOrder(jsonResponse(200, []), jsonResponse(200, { items: [], previousCursor: null, nextCursor: null })));

    await callDefinition(definitionApi.getQuestionUsage, { params: { questionId: QUESTION_ID } });
    await callReporting(reportingApi.listSessions, { params: { id: QUESTIONNAIRE_ID }, query: { cursor: "abc" } });

    expect(spanCalls.map(([name, context]) => [name, context])).toEqual([
      ["browser.request", { method: "GET", route: `${definitionApi.DEFINITION_PREFIX}${definitionApi.getQuestionUsage.url}` }],
      ["browser.request", { method: "GET", route: `${reportingApi.REPORTING_PREFIX}${reportingApi.listSessions.url}` }],
    ]);
    expect(JSON.stringify(spanCalls.map(([, context]) => context))).not.toMatch(new RegExp(`${QUESTION_ID}|${QUESTIONNAIRE_ID}|abc`));
  });
});
