import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ProblemDetails } from "../problems.js";
import * as definition from "./definition.js";
import { formatDraftEtag, parseDraftEtag } from "./etag.js";
import * as execution from "./execution.js";
import type { BodyOf, ReplyOf } from "./route.js";

const routes = [...definition.definitionRoutes, ...execution.executionRoutes];

describe("route contract", () => {
  it("defines the 18 definition and 3 execution routes of [[7-application-boundary]] §4.1 and §5.1", () => {
    expect(definition.definitionRoutes.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET /questions",
      "POST /questions",
      "GET /questions/:questionId",
      "GET /questions/:questionId/versions",
      "GET /questions/:questionId/versions/:v",
      "POST /questions/:questionId/versions",
      "POST /questions/:questionId/archive",
      "GET /questions/:questionId/usage",
      "GET /questionnaires",
      "POST /questionnaires",
      "GET /questionnaires/:id/draft",
      "PUT /questionnaires/:id/draft",
      "POST /questionnaires/:id/draft/validate",
      "POST /questionnaires/:id/publish",
      "POST /questionnaires/:id/draft",
      "GET /questionnaires/:id/versions",
      "GET /questionnaires/:id/versions/:v",
      "PUT /questionnaires/:id/closes-at",
    ]);
    expect(execution.executionRoutes.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST /sessions",
      "GET /sessions/:sessionId",
      "POST /sessions/:sessionId/submit",
    ]);
  });

  it("gives every route the problem body for 4xx and 5xx", () => {
    for (const route of routes) {
      expect(route.schema.response["4xx"]).toBe(ProblemDetails);
      expect(route.schema.response["5xx"]).toBe(ProblemDetails);
    }
  });

  it("has no execution route that takes a questionnaireId in the path (#18)", () => {
    for (const route of execution.executionRoutes) expect(route.url).not.toMatch(/questionnaire/i);
  });

  it("requires If-Match on the two draft-consuming writes, so a missing header is a schema 400 (#43)", () => {
    for (const route of [definition.replaceDraft, definition.publishDraft]) {
      expect(Value.Check(route.schema.headers, { "if-match": 'W/"x:1"', accept: "*/*" })).toBe(true);
      expect(Value.Check(route.schema.headers, { accept: "*/*" })).toBe(false);
    }
  });

  it("accepts a submit body keyed by itemId", () => {
    const body: BodyOf<typeof execution.submitSession> = {
      answers: {
        itm_01: { type: "single_choice", optionId: "yes" },
        itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" },
        itm_03: { type: "date", date: "2019-04-02" },
        itm_04: null,
      },
    };
    expect(Value.Check(execution.submitSession.schema.body, body)).toBe(true);
  });

  it("types replies from the schema", () => {
    const reply: ReplyOf<typeof execution.submitSession, 200> = {
      receipt: {
        sessionId: "0b6c1f7e-6f0a-4b8e-9c2d-3f7a1e5d9b20",
        questionnaireId: "01a0950e-56a0-73d6-b936-4a1e10eff8c0",
        version: 2,
        submittedAt: "2026-09-13T18:04:11Z",
      },
    };
    expect(Value.Check(execution.submitSession.schema.response[200], reply)).toBe(true);
  });
});

describe("draft ETag", () => {
  const versionId = "01a0950e-5701-7a3c-9e1b-2c4d6f8a0b1c";

  it("round-trips W/\"<versionId>:<draftRevision>\"", () => {
    const etag = formatDraftEtag(versionId, 7);
    expect(etag).toBe(`W/"${versionId}:7"`);
    expect(parseDraftEtag(etag)).toEqual({ versionId, draftRevision: 7 });
  });

  it.each(['"x"', `W/"${versionId}"`, `W/"${versionId}:-1"`, `W/"${versionId}:01"`, "*"])("rejects %s", (etag) => {
    expect(parseDraftEtag(etag)).toBeUndefined();
  });
});
