import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { QuestionBankScreen } from "../../src/screens/question-bank";
import { fillJsdomLayoutGaps, withQueryClient } from "./question-editor/harness";

beforeAll(fillJsdomLayoutGaps);

describe("the question bank's New question button", () => {
  it("opens the question editor with focus inside, keeps Tab inside it, and gives focus back to the button on close", async () => {
    render(withQueryClient(<QuestionBankScreen />));
    const opener = screen.getByRole("button", { name: "New question" });

    await userEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "New question" });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null));
    for (let step = 0; step < 25; step += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    for (let step = 0; step < 25; step += 1) {
      await userEvent.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes from Cancel without writing anything", async () => {
    render(withQueryClient(<QuestionBankScreen />));
    const opener = screen.getByRole("button", { name: "New question" });

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
