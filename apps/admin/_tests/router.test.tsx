import { problemResponse, stubFetch } from "@qp/ui/testing";
import { createMemoryHistory } from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "../src/router";
import { QUESTIONNAIRE_ID } from "./support/builders";
import { renderAppAt, testQueryClient } from "./support/render-app";

const renderAt = (path: string) => renderAppAt(path).router;

describe("the admin route tree", () => {
  it.each([
    ["/questionnaires", "Questionnaires"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/draft`, "Draft editor"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/versions`, "Version history"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/versions/2`, "Preview of version 2"],
    ["/questions", "Question bank"],
  ])("resolves %s to its screen", async (path, heading) => {
    const router = renderAt(path);

    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(path);
  });

  it("hands the questionnaire id from the path to the screen", async () => {
    const requests = stubFetch(() => problemResponse("internal", { detail: "trace-1" }));
    renderAt(`/questionnaires/${QUESTIONNAIRE_ID}/draft`);

    await waitFor(() =>
      expect(requests.map(({ url }) => url)).toContain(`/api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft`),
    );
  });

  it("redirects the admin root to the questionnaire list", async () => {
    const router = renderAt("/");

    expect(await screen.findByRole("heading", { level: 1, name: "Questionnaires" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/questionnaires");
  });

  it.each(["/drafts", "/questionnaires/x/draft/extra"])("renders the not-found screen inside the shell for %s", async (path) => {
    renderAt(path);

    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it.each([
    "/questionnaires/not-a-uuid/draft",
    "/questionnaires/not-a-uuid/versions",
    "/questionnaires/not-a-uuid/versions/1",
    `/questionnaires/${QUESTIONNAIRE_ID}/versions/0`,
    `/questionnaires/${QUESTIONNAIRE_ID}/versions/01`,
    `/questionnaires/${QUESTIONNAIRE_ID}/versions/latest`,
  ])("renders the not-found screen, without asking the API, for the malformed address %s", async (path) => {
    const requests = stubFetch(() => problemResponse("internal", { detail: "unreachable" }));
    renderAt(path);

    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to questionnaires" })).toHaveAttribute("href", "/admin/questionnaires");
    expect(requests.filter(({ url }) => url.includes("/questionnaires/"))).toEqual([]);
  });

  it.each([
    ["/questionnaires", "Questionnaires"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/draft`, "Draft editor"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/versions`, "Version history"],
    [`/questionnaires/${QUESTIONNAIRE_ID}/versions/3`, "Preview of version 3"],
    ["/questions", "Question bank"],
    ["/drafts", "Page not found"],
    ["/questionnaires/not-a-uuid/draft", "Page not found"],
  ])("titles the document for %s", async (path, page) => {
    stubFetch(() => problemResponse("internal", { detail: "not under test" }));
    renderAt(path);

    await waitFor(() => expect(document.title).toBe(`${page} · Questionnaire admin`));
  });

  it("registers no route for the question editor, which is a dialog", () => {
    const router = createAppRouter({ queryClient: testQueryClient(), history: createMemoryHistory() });

    expect(Object.keys(router.routesByPath).sort()).toEqual([
      "/",
      "/questionnaires",
      "/questionnaires/$questionnaireId/draft",
      "/questionnaires/$questionnaireId/responses",
      "/questionnaires/$questionnaireId/responses/$sessionId",
      "/questionnaires/$questionnaireId/versions",
      "/questionnaires/$questionnaireId/versions/$version",
      "/questions",
    ]);
  });
});
