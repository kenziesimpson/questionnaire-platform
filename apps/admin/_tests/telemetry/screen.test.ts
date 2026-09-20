import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "../../src/router";
import { routeTemplateOf } from "../../src/telemetry/screen";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { sessionIdOf } from "../support/reporting";
import { testQueryClient } from "../support/render-app";

function routerAt(path: string) {
  return createAppRouter({ queryClient: testQueryClient(), history: createMemoryHistory({ initialEntries: [`/admin${path}`] }) });
}

describe("routeTemplateOf", () => {
  it("names the matched route by its template, with the parameters unfilled", async () => {
    const router = routerAt(`/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(1)}?cursor=abc&version=2`);
    await router.load();

    const template = routeTemplateOf(router);

    expect(template).toBe("/questionnaires/$questionnaireId/responses/$sessionId");
    expect(template).not.toContain(QUESTIONNAIRE_ID);
    expect(template).not.toContain(sessionIdOf(1));
    expect(template).not.toContain("cursor");
  });

  it.each([
    ["/questionnaires", "/questionnaires"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/responses`, "/questionnaires/$questionnaireId/responses"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/draft`, "/questionnaires/$questionnaireId/draft"],
    ["/questions", "/questions"],
  ])("names %s by %s", async (path, expected) => {
    const router = routerAt(path);
    await router.load();

    expect(routeTemplateOf(router)).toBe(expected);
  });

  it("names nothing for a path no route matches", async () => {
    const router = routerAt("/nowhere");
    await router.load();

    expect(routeTemplateOf(router)).toBeUndefined();
  });

  it("names nothing before a route has matched", () => {
    expect(routeTemplateOf({ state: { matches: [] } })).toBeUndefined();
    expect(routeTemplateOf({ state: { matches: [{ routeId: "__root__" }] } })).toBeUndefined();
  });
});
