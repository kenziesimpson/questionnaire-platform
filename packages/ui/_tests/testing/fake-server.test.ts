import { definitionApi, executionApi } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { FakeServer, contractResponse, jsonReply, jsonResponse, networkFailure, urlOf } from "../../src/testing";

describe("urlOf", () => {
  it("fills a route's path parameters and query under its prefix", () => {
    expect(urlOf(executionApi.EXECUTION_PREFIX, executionApi.submitSession, { params: { sessionId: "s 1" } })).toBe(
      "/api/run/sessions/s%201/submit",
    );
    expect(urlOf(definitionApi.DEFINITION_PREFIX, definitionApi.listQuestions, { query: { includeArchived: false } })).toBe(
      "/api/definition/questions?includeArchived=false",
    );
  });
});

describe("FakeServer", () => {
  it("records each request and answers from the replies queued for its method and URL, in order", async () => {
    const server = new FakeServer().on("POST", "/api/run/sessions", jsonReply(201, { first: true }), jsonReply(201, { second: true }));

    const first = await server.fetch("/api/run/sessions", { method: "POST", headers: { "if-match": "W/1" }, body: JSON.stringify({ a: 1 }) });
    const second = await server.fetch("/api/run/sessions", { method: "POST" });

    expect(await first.json()).toEqual({ first: true });
    expect(await second.json()).toEqual({ second: true });
    expect(server.sent("POST", "/api/run/sessions")).toMatchObject([
      { method: "POST", url: "/api/run/sessions", body: { a: 1 } },
      { method: "POST", url: "/api/run/sessions", body: undefined },
    ]);
    expect(server.requests[0]?.headers.get("if-match")).toBe("W/1");
  });

  it("rejects a request nothing was queued for, naming it, and passes a network failure through", async () => {
    const server = new FakeServer().on("GET", "/down", networkFailure());

    await expect(server.fetch("/nowhere")).rejects.toThrow("no reply queued for GET /nowhere");
    await expect(server.fetch("/down")).rejects.toThrow(TypeError);
  });

  it("hands a request nothing was queued for to the reply it was built with", async () => {
    const server = new FakeServer(({ method, url }) => jsonResponse(200, { method, url })).on("GET", "/queued", jsonReply(200, "queued"));

    expect(await (await server.fetch("/queued")).json()).toBe("queued");
    expect(await (await server.fetch("/queued")).json()).toEqual({ method: "GET", url: "/queued" });
  });
});

describe("contractResponse", () => {
  it("answers with a body the route declares for that status and throws on any other", () => {
    expect(contractResponse(definitionApi.listQuestionnaires, 200, []).status).toBe(200);
    expect(() => contractResponse(definitionApi.listQuestionnaires, 200, [{ name: "no id" }])).toThrow("the contract rejects");
    expect(() => contractResponse(definitionApi.listQuestionnaires, 201, [])).toThrow("the contract rejects");
  });
});
