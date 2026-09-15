import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app";
import { createAppRouter } from "../../src/router";
import { QUESTIONNAIRE_ID, problemResponse, stubFetch, testQueryClient } from "../fixtures";

const JSDOM_CANNOT_EVALUATE = { "color-contrast": { enabled: false } };

async function renderShellAt(path: string) {
  const queryClient = testQueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [`/admin${path}`] }) });
  const { container } = render(<App queryClient={queryClient} router={router} />);
  await screen.findByRole("heading", { level: 1 });
  return { container, router };
}

describe("the app shell", () => {
  it.each(["/questionnaires", `/questionnaires/${QUESTIONNAIRE_ID}/versions/1`, "/questions", "/nowhere"])(
    "has no axe violations at %s",
    async (path) => {
      const { container } = await renderShellAt(path);

      const results = await axe.run(container, { rules: JSDOM_CANNOT_EVALUATE });

      expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
    },
  );

  it("has a banner, a main navigation and a main landmark", async () => {
    await renderShellAt("/questionnaires");

    expect(screen.getByRole("banner")).toHaveTextContent("Questionnaire admin");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1, name: "Questionnaires" }));
  });

  it.each([
    `/questionnaires/${QUESTIONNAIRE_ID}/draft`,
    `/questionnaires/${QUESTIONNAIRE_ID}/versions`,
    `/questionnaires/${QUESTIONNAIRE_ID}/versions/1`,
    "/questionnaires/nope/draft",
  ])(
    "marks only the main navigation link current at %s, never a back link inside the screen",
    async (path) => {
      stubFetch(() => problemResponse("resource/not-found"));
      await renderShellAt(path);
      await screen.findAllByRole("link", { name: /^Back to/ });

      const current = screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"));

      expect(current.map((link) => link.textContent)).toEqual(["Questionnaires"]);
    },
  );

  it("marks Questionnaires current on every questionnaire screen and Question bank on the bank", async () => {
    const { router } = await renderShellAt(`/questionnaires/${QUESTIONNAIRE_ID}/draft`);
    const questionnaires = screen.getByRole("link", { name: "Questionnaires" });
    const bank = screen.getByRole("link", { name: "Question bank" });

    expect(questionnaires).toHaveAttribute("aria-current", "page");
    expect(bank).not.toHaveAttribute("aria-current");

    await userEvent.click(bank);

    expect(await screen.findByRole("heading", { level: 1, name: "Question bank" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/questions");
    expect(bank).toHaveAttribute("aria-current", "page");
    expect(questionnaires).not.toHaveAttribute("aria-current");
    expect(bank).toHaveAttribute("href", "/admin/questions");
  });
});
