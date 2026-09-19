import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ProblemDetails } from "../../src/problems.js";
import * as reporting from "../../src/api/reporting.js";

const QUESTIONNAIRE_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";
const SESSION_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c1";

describe("the reporting routes", () => {
  it("are the two read-only routes of the admin responses browser, under their own prefix", () => {
    expect(reporting.REPORTING_PREFIX).toBe("/api/reporting");
    expect(reporting.reportingRoutes.map((route) => `${route.method} ${route.url}`)).toEqual([
      "GET /questionnaires/:id/responses",
      "GET /questionnaires/:id/responses/:sessionId",
    ]);
  });

  it("give both the problem body for 4xx and 5xx", () => {
    for (const route of reporting.reportingRoutes) {
      expect(route.schema.response["4xx"]).toBe(ProblemDetails);
      expect(route.schema.response["5xx"]).toBe(ProblemDetails);
    }
  });

  it("have no route that writes", () => {
    for (const route of reporting.reportingRoutes) expect(route.method).toBe("GET");
  });
});

describe("the sessions list query", () => {
  const query = reporting.listSessions.schema.querystring;

  it("accepts no filter, either filter, or both, with a cursor", () => {
    expect(Value.Check(query, {})).toBe(true);
    expect(Value.Check(query, { version: 2 })).toBe(true);
    expect(Value.Check(query, { status: "in_progress" })).toBe(true);
    expect(Value.Check(query, { version: 1, status: "submitted", cursor: "abc" })).toBe(true);
  });

  it.each([
    ["version 0", { version: 0 }],
    ["a fractional version", { version: 1.5 }],
    ["an unknown status", { status: "abandoned" }],
    ["an empty cursor", { cursor: "" }],
    ["a cursor longer than any the server issues", { cursor: "a".repeat(129) }],
    ["a page size, which is fixed", { limit: 5 }],
    ["a sort order, which is fixed", { sort: "asc" }],
  ])("rejects %s", (_, extra) => {
    expect(Value.Check(query, extra)).toBe(false);
  });

  it("takes the questionnaire id as a uuid path parameter", () => {
    const params = reporting.listSessions.schema.params;

    expect(Value.Check(params, { id: QUESTIONNAIRE_ID })).toBe(true);
    expect(Value.Check(params, { id: "not-a-uuid" })).toBe(false);
  });
});

describe("the session detail params", () => {
  const params = reporting.getSessionDetail.schema.params;

  it("need both ids to be uuids", () => {
    expect(Value.Check(params, { id: QUESTIONNAIRE_ID, sessionId: SESSION_ID })).toBe(true);
    expect(Value.Check(params, { id: QUESTIONNAIRE_ID, sessionId: SESSION_ID.slice(0, 8) })).toBe(false);
    expect(Value.Check(params, { id: QUESTIONNAIRE_ID })).toBe(false);
  });
});
