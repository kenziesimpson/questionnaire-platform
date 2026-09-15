import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/app";
import { createAppRouter } from "../src/router";
import { QUESTIONNAIRE_ID, testQueryClient } from "./fixtures";

function renderAt(path: string) {
  const queryClient = testQueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [`/admin${path}`] }) });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

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
    renderAt(`/questionnaires/${QUESTIONNAIRE_ID}/draft`);

    expect(await screen.findByText(QUESTIONNAIRE_ID)).toBeInTheDocument();
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

  it("registers no route for the question editor, which is a dialog", () => {
    const router = createAppRouter({ queryClient: testQueryClient(), history: createMemoryHistory() });

    expect(Object.keys(router.routesByPath).sort()).toEqual([
      "/",
      "/questionnaires",
      "/questionnaires/$questionnaireId/draft",
      "/questionnaires/$questionnaireId/versions",
      "/questionnaires/$questionnaireId/versions/$version",
      "/questions",
    ]);
  });
});
