import { PROBLEM_CONTENT_TYPE, problem, sensitive, type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { createEventQueue, routeLogsToQueue, type QueuedEvent } from "@qp/telemetry/browser";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createSession, getSession, submitSession } from "../../src/api/execution-client";
import { ANSWER_SENTINEL, inProgressSession, intakeV1, receipt, SESSION_ID, submittedSession } from "../fixtures";

type FetchMock = Mock<typeof fetch>;

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(status: number, body: unknown, contentType = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  fetchMock.mockResolvedValue(new Response(text, { status, headers: { "content-type": contentType } }));
}

function respondWithProblem(body: { readonly status: number; readonly [extension: string]: unknown }) {
  respondWith(body.status, body, PROBLEM_CONTENT_TYPE);
}

function failNetwork() {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
}

function sentRequest() {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === "string" ? init.body : undefined;
  return { url, method: init?.method, contentType: headers.get("content-type"), body };
}

const sessionUrl = `/api/run/sessions/${SESSION_ID}`;

const answers: ClientAnswers = {
  itm_01: { type: "single_choice", optionId: "yes" },
  itm_02: { type: "single_choice", optionId: "other", otherText: ANSWER_SENTINEL },
  itm_03: { type: "date", date: "2019-04-02" },
  itm_04: { type: "text", text: "Corner pharmacy" },
};

const invalidRequest = problem("request/invalid", { errors: [{ pointer: "/body/questionnaireId", code: "schema/format" }] });
const notFound = problem("resource/not-found", { instance: "/api/run/sessions" });
const closed = problem("questionnaire/closed", { instance: "/api/run/sessions" });
const internal = problem("internal", { detail: "0b6f7c1e-correlation" });
const alreadySubmitted = problem("session/already-submitted", { instance: `${sessionUrl}/submit` });
const submissionInvalid = problem("submission/invalid", {
  instance: `${sessionUrl}/submit`,
  items: [
    { itemId: "itm_02", code: "choice/other-text-required" },
    { itemId: "itm_03", code: "date/in-future" },
  ],
});

describe("createSession", () => {
  it("posts the questionnaire id to /api/run/sessions and returns the session and definition on 201", async () => {
    respondWith(201, { session: inProgressSession, definition: intakeV1 });

    const outcome = await createSession(INTAKE_QUESTIONNAIRE_ID);

    expect(outcome).toEqual({ kind: "ok", body: { session: inProgressSession, definition: intakeV1 } });
    expect(sentRequest()).toEqual({
      url: "/api/run/sessions",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ questionnaireId: INTAKE_QUESTIONNAIRE_ID }),
    });
  });

  it.each([
    ["request/invalid", invalidRequest],
    ["resource/not-found", notFound],
    ["questionnaire/closed", closed],
    ["internal", internal],
  ] as const)("parses a %s problem", async (slug, body) => {
    respondWithProblem(body);

    expect(await createSession(INTAKE_QUESTIONNAIRE_ID)).toEqual({ kind: "problem", slug, problem: body });
  });

  it("treats a slug the route cannot return as an unexpected response", async () => {
    respondWithProblem(alreadySubmitted);

    expect(await createSession(INTAKE_QUESTIONNAIRE_ID)).toEqual({ kind: "unexpected-response", status: 409 });
  });

  it("surfaces a thrown fetch as a network error", async () => {
    failNetwork();

    expect(await createSession(INTAKE_QUESTIONNAIRE_ID)).toEqual({ kind: "network-error" });
  });
});

describe("getSession", () => {
  it.each([
    ["in-progress", inProgressSession],
    ["submitted", submittedSession],
  ] as const)("gets /api/run/sessions/:sessionId and returns a %s session with its definition on 200", async (_label, session) => {
    respondWith(200, { session, definition: intakeV1 });

    const outcome = await getSession(SESSION_ID);

    expect(outcome).toEqual({ kind: "ok", body: { session, definition: intakeV1 } });
    expect(sentRequest()).toEqual({ url: sessionUrl, method: "GET", contentType: null, body: undefined });
  });

  it("encodes the session id into the path", async () => {
    failNetwork();

    await getSession("not/a uuid");

    expect(sentRequest().url).toBe("/api/run/sessions/not%2Fa%20uuid");
  });

  it.each([
    ["request/invalid", invalidRequest],
    ["resource/not-found", notFound],
    ["questionnaire/closed", closed],
    ["internal", internal],
  ] as const)("parses a %s problem", async (slug, body) => {
    respondWithProblem(body);

    expect(await getSession(SESSION_ID)).toEqual({ kind: "problem", slug, problem: body });
  });

  it("treats a slug the route cannot return as an unexpected response", async () => {
    respondWithProblem(submissionInvalid);

    expect(await getSession(SESSION_ID)).toEqual({ kind: "unexpected-response", status: 422 });
  });

  it("surfaces a thrown fetch as a network error", async () => {
    failNetwork();

    expect(await getSession(SESSION_ID)).toEqual({ kind: "network-error" });
  });
});

describe("submitSession", () => {
  it("posts the unwrapped answers to /api/run/sessions/:sessionId/submit and returns the receipt on 200", async () => {
    respondWith(200, { receipt });

    const outcome = await submitSession(SESSION_ID, sensitive(answers));

    expect(outcome).toEqual({ kind: "ok", body: { receipt } });
    expect(sentRequest()).toEqual({
      url: `${sessionUrl}/submit`,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ answers }),
    });
  });

  it.each([
    ["request/invalid", invalidRequest],
    ["resource/not-found", notFound],
    ["questionnaire/closed", closed],
    ["session/already-submitted", alreadySubmitted],
    ["submission/invalid", submissionInvalid],
    ["internal", internal],
  ] as const)("parses a %s problem", async (slug, body) => {
    respondWithProblem(body);

    expect(await submitSession(SESSION_ID, sensitive(answers))).toEqual({ kind: "problem", slug, problem: body });
  });

  it("lets a caller switch on the slug to reach the submission items", async () => {
    respondWithProblem(submissionInvalid);

    const outcome = await submitSession(SESSION_ID, sensitive(answers));

    const itemIds = outcome.kind === "problem" && outcome.slug === "submission/invalid" ? outcome.problem.items.map((item) => item.itemId) : [];
    expect(itemIds).toEqual(["itm_02", "itm_03"]);
  });

  it("surfaces a thrown fetch as a network error", async () => {
    failNetwork();

    expect(await submitSession(SESSION_ID, sensitive(answers))).toEqual({ kind: "network-error" });
  });

  it("surfaces a body that fails to arrive as a network error", async () => {
    const response = new Response(JSON.stringify({ receipt }), { status: 200 });
    vi.spyOn(response, "text").mockRejectedValue(new TypeError("network error"));
    fetchMock.mockResolvedValue(response);

    expect(await submitSession(SESSION_ID, sensitive(answers))).toEqual({ kind: "network-error" });
  });

  it("never carries an answer value in any outcome", async () => {
    const outcomes = [];
    for (const arrange of [
      () => respondWith(200, { receipt }),
      () => respondWithProblem(submissionInvalid),
      () => respondWithProblem(alreadySubmitted),
      () => respondWith(502, "<html>Bad Gateway</html>", "text/html"),
      failNetwork,
    ]) {
      arrange();
      outcomes.push(await submitSession(SESSION_ID, sensitive(answers)));
    }

    expect(JSON.stringify(outcomes)).not.toContain(ANSWER_SENTINEL);
    expect(String(sensitive(answers))).not.toContain(ANSWER_SENTINEL);
  });
});

describe("unexpected responses", () => {
  it("a success status whose body fails the route's schema", async () => {
    respondWith(201, { session: inProgressSession });

    expect(await createSession(INTAKE_QUESTIONNAIRE_ID)).toEqual({ kind: "unexpected-response", status: 201 });
  });

  it("a declared success body under another status", async () => {
    respondWith(200, { session: inProgressSession, definition: intakeV1 });

    expect(await createSession(INTAKE_QUESTIONNAIRE_ID)).toEqual({ kind: "unexpected-response", status: 200 });
  });

  it("a non-JSON error page from a proxy", async () => {
    respondWith(502, "<html>Bad Gateway</html>", "text/html");

    expect(await getSession(SESSION_ID)).toEqual({ kind: "unexpected-response", status: 502 });
  });

  it("a problem whose status disagrees with its slug", async () => {
    respondWith(404, closed, PROBLEM_CONTENT_TYPE);

    expect(await getSession(SESSION_ID)).toEqual({ kind: "unexpected-response", status: 404 });
  });

  it("a problem type outside the shared union", async () => {
    respondWith(409, { ...closed, type: "https://qp.example/problems/made-up" }, PROBLEM_CONTENT_TYPE);

    expect(await getSession(SESSION_ID)).toEqual({ kind: "unexpected-response", status: 409 });
  });

  it("a shared slug the execution API never returns", async () => {
    respondWithProblem(problem("version/immutable"));

    expect(await submitSession(SESSION_ID, sensitive(answers))).toEqual({ kind: "unexpected-response", status: 409 });
  });

  it("a submission problem naming a code that is not a submission code", async () => {
    respondWithProblem({ ...submissionInvalid, items: [{ itemId: "itm_02", code: "predicate/unsatisfiable" }] });

    expect(await submitSession(SESSION_ID, sensitive(answers))).toEqual({ kind: "unexpected-response", status: 422 });
  });

  it.each([
    ["request/invalid without errors", { type: invalidRequest.type, title: invalidRequest.title, status: 400 }],
    ["submission/invalid without items", { type: submissionInvalid.type, title: submissionInvalid.title, status: 422 }],
    ["internal without a correlation id", { type: internal.type, title: internal.title, status: 500 }],
  ])("a %s problem", async (_label, body) => {
    respondWithProblem(body);

    expect(await submitSession(SESSION_ID, sensitive(answers))).toEqual({ kind: "unexpected-response", status: body.status });
  });
});

describe("trace context and client warnings", () => {
  const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/;

  function headersSent(call = 0): Headers {
    return new Headers(fetchMock.mock.calls[call]?.[1]?.headers);
  }

  it.each([
    ["createSession", () => createSession(INTAKE_QUESTIONNAIRE_ID), 201, ["accept", "content-type", "traceparent"]],
    ["getSession", () => getSession(SESSION_ID), 200, ["accept", "traceparent"]],
    ["submitSession", () => submitSession(SESSION_ID, sensitive(answers)), 200, ["accept", "content-type", "traceparent"]],
  ] as const)("sends one traceparent and no other new header on %s, with nothing started", async (_name, call, status, names) => {
    respondWith(status, {});

    await call();

    const headers = headersSent();
    expect(headers.get("traceparent")).toMatch(TRACEPARENT);
    expect([...headers.keys()].sort()).toEqual([...names]);
    expect(JSON.stringify([...headers.entries()])).not.toContain(ANSWER_SENTINEL);
  });

  it("puts a traceparent naming no route, session id or answer, only ids and flags", async () => {
    respondWith(200, { session: inProgressSession, definition: intakeV1 });

    await getSession(SESSION_ID);

    const traceparent = headersSent().get("traceparent") ?? "";
    expect(traceparent).not.toContain(SESSION_ID);
    expect(traceparent.split("-")).toHaveLength(4);
  });

  it("sends the page's one trace id with a different span id on each request", async () => {
    respondWith(200, { session: inProgressSession, definition: intakeV1 });

    await getSession(SESSION_ID);
    respondWith(200, { session: inProgressSession, definition: intakeV1 });
    await getSession(SESSION_ID);

    const [first, second] = [0, 1].map((call) => (headersSent(call).get("traceparent") ?? "").split("-"));
    expect(first?.[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(second?.[1]).toBe(first?.[1]);
    expect(second?.[2]).not.toBe(first?.[2]);
  });

  it("queues one client warning naming the method and the route template, never the url, when the request fails", async () => {
    const sent: QueuedEvent[] = [];
    const queue = createEventQueue({
      send: (events) => {
        sent.push(...events);
      },
      beacon: () => true,
    });
    const stopRouting = routeLogsToQueue(queue);
    failNetwork();

    await getSession(SESSION_ID);
    stopRouting();
    queue.flush();
    queue.close();

    expect(sent).toEqual([
      {
        level: "warn",
        at: expect.any(String),
        traceparent: expect.stringMatching(TRACEPARENT),
        message: "request failed",
        attributes: { "http.request.method": "GET", "http.route": "/api/run/sessions/:sessionId", module: "browser" },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain(SESSION_ID);
  });
});
