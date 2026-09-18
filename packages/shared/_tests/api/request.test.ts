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

  it("accepts a name of letters, digits and inner underscores, and refuses one ending in an underscore", () => {
    expect(routePath("/u/:user_id/v/:v2", { user_id: "7", v2: "3" })).toBe("/u/7/v/3");
    expect(() => routePath("/u/:user_", { user_: "7" })).toThrow('Path parameter ":user_" in /u/:user_ ends in an underscore');
  });

  it.each([
    ["an empty value", ""],
    ["a single dot", "."],
    ["a double dot", ".."],
  ])("refuses %s, which is not a path segment", (_, value) => {
    expect(() => routePath("/sessions/:sessionId/submit", { sessionId: value })).toThrow("empty or a relative segment");
  });

  it("cannot be made to climb out of its segment", () => {
    const climbers = ["..", ".", "", "../..", "%2e%2e", "../admin", "a/../..", "\\u002e\\u002e"];

    for (const sessionId of climbers) {
      let path: string;
      try {
        path = routePath("/sessions/:sessionId/submit", { sessionId });
      } catch {
        continue;
      }
      expect(new URL(`https://qp.example/api/run${path}`).pathname).toBe(`/api/run/sessions/${encodeURIComponent(sessionId)}/submit`);
    }
  });
});

describe("routeSearch", () => {
  it("is empty for no query and for one whose every value is undefined", () => {
    expect(routeSearch()).toBe("");
    expect(routeSearch({ includeArchived: undefined })).toBe("");
  });

  it("encodes the declared values and drops the undefined ones", () => {
    expect(routeSearch({ includeArchived: true, after: undefined, q: "a b&c" })).toBe("?includeArchived=true&q=a+b%26c");
  });

  it("encodes exactly as URLSearchParams does, so replacing it changed no request on the wire", () => {
    const values = [...Array.from({ length: 0x80 }, (_, code) => String.fromCharCode(code)), "é", "日", "🙂", "a b", "a+b", "a&b=c", ""];

    for (const value of values) expect(routeSearch({ k: value })).toBe(`?${new URLSearchParams({ k: value }).toString()}`);
    for (const name of ["a b", "a&b", "é"]) expect(routeSearch({ [name]: "v" })).toBe(`?${new URLSearchParams([[name, "v"]]).toString()}`);
  });
});

describe("successSchemaOf", () => {
  it("answers the schema the route declares for that status", () => {
    expect(successSchemaOf(definition.listQuestionnaires, 200)).toBe(definition.listQuestionnaires.schema.response[200]);
    expect(successSchemaOf(execution.createSession, 201)).toBe(execution.createSession.schema.response[201]);
  });

  it("answers undefined for a success status the route does not declare", () => {
    expect(successSchemaOf(definition.listQuestionnaires, 201)).toBeUndefined();
    expect(successSchemaOf(execution.createSession, 200)).toBeUndefined();
  });

  it("cannot be asked for the problem schemas, which are the only response keys that are not statuses", () => {
    expect(Object.keys(definition.listQuestionnaires.schema.response)).toEqual(["200", "4xx", "5xx"]);

    const _typeChecks = () => {
      // @ts-expect-error — "4xx" is not a status, so the problem schema cannot be asked for by name
      successSchemaOf(definition.listQuestionnaires, "4xx");
      // @ts-expect-error — nor can the 5xx one
      successSchemaOf(definition.listQuestionnaires, "5xx");
    };
    expect(_typeChecks).toBeTypeOf("function");
  });
});
