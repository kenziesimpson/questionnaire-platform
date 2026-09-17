import { describe, expect, it } from "vitest";
import * as definition from "../../src/api/definition.js";
import * as execution from "../../src/api/execution.js";
import { routePath, routeSearch, successSchemaOf } from "../../src/api/request.js";

describe("routePath", () => {
  it("substitutes each parameter, percent-encoded", () => {
    expect(routePath("/sessions/:sessionId/submit", { sessionId: "a/b c" })).toBe("/sessions/a%2Fb%20c/submit");
  });

  it("fills several parameters in one path and leaves the rest of it alone", () => {
    expect(routePath("/questionnaires/:id/versions/:v", { id: "q1", v: 2 })).toBe("/questionnaires/q1/versions/2");
  });

  it("throws naming the parameter, not its value, when one is missing", () => {
    expect(() => routePath("/sessions/:sessionId", {})).toThrow('Missing path parameter "sessionId"');
  });

  it("returns a path with no parameters unchanged", () => {
    expect(routePath(definition.listQuestionnaires.url)).toBe("/questionnaires");
  });
});

describe("routeSearch", () => {
  it("is empty for no query and for one whose every value is undefined", () => {
    expect(routeSearch()).toBe("");
    expect(routeSearch({ includeArchived: undefined })).toBe("");
  });

  it("encodes the declared values and drops the undefined ones", () => {
    expect(routeSearch({ includeArchived: true, after: undefined, q: "a b&c" })).toBe("?includeArchived=true&q=a%20b%26c");
  });
});

describe("successSchemaOf", () => {
  it("answers the schema the route declares for that status", () => {
    expect(successSchemaOf(definition.listQuestionnaires, 200)).toBe(definition.listQuestionnaires.schema.response[200]);
    expect(successSchemaOf(execution.createSession, 201)).toBe(execution.createSession.schema.response[201]);
  });

  it("answers undefined for a status the route does not declare, so a problem schema can never stand in for a success one", () => {
    expect(successSchemaOf(definition.listQuestionnaires, 201)).toBeUndefined();
    expect(successSchemaOf(definition.listQuestionnaires, 404)).toBeUndefined();
    expect(successSchemaOf(definition.listQuestionnaires, 500)).toBeUndefined();
  });
});
