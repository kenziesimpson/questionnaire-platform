import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "../../src/primitives/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../src/primitives/dialog";
import { violationsInDocumentIncludingPortals } from "../axe";

function EditQuestionDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Edit question</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit question</DialogTitle>
          <DialogDescription>Saving writes a new version.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("opens a modal dialog named by its title and described by its description, with focus inside", async () => {
    render(<EditQuestionDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit question" }));

    const dialog = screen.getByRole("dialog", { name: "Edit question" });
    expect(dialog).toHaveAccessibleDescription("Saving writes a new version.");
    expect(dialog).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<EditQuestionDialog />);
    const trigger = screen.getByRole("button", { name: "Edit question" });
    await userEvent.click(trigger);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes from a DialogClose button", async () => {
    render(<EditQuestionDialog />);
    await userEvent.click(screen.getByRole("button", { name: "Edit question" }));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("finds no axe violations closed or open", async () => {
    render(<EditQuestionDialog />);
    expect(await violationsInDocumentIncludingPortals()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Edit question" }));

    expect(await violationsInDocumentIncludingPortals()).toEqual([]);
  });
});
