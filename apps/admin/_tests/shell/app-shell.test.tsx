import { axeViolations, problemResponse, stubFetch } from "@qp/ui/testing";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { renderAppAt } from "../support/render-app";

async function renderShellAt(path: string) {
  const { container, router } = renderAppAt(path);
  await screen.findByRole("heading", { level: 1 });
  return { container, router };
}

describe("the app shell", () => {
  it.each(["/questionnaires", `/questionnaires/${QUESTIONNAIRE_ID}/versions/1`, "/questions", "/nowhere"])(
    "has no axe violations at %s",
    async (path) => {
      const { container } = await renderShellAt(path);

      expect(await axeViolations(container)).toEqual([]);
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
