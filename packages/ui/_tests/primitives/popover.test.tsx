import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "../../src/primitives/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "../../src/primitives/popover";
import { componentAxeViolations } from "../../src/testing";

function StalenessPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Pinned version</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Pinned version details">
        <PopoverHeader>
          <PopoverTitle>Version 2 is pinned</PopoverTitle>
          <PopoverDescription>Version 3 is the latest.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  it("toggles its content from the trigger and reports the state through aria-expanded", async () => {
    render(<StalenessPopover />);
    const trigger = screen.getByRole("button", { name: "Pinned version" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const content = screen.getByRole("dialog", { name: "Pinned version details" });
    expect(content).toHaveTextContent("Version 2 is pinned");
    expect(content).toHaveTextContent("Version 3 is the latest.");
    expect(trigger).toHaveAttribute("aria-controls", content.id);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<StalenessPopover />);
    const trigger = screen.getByRole("button", { name: "Pinned version" });
    await userEvent.click(trigger);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("finds no axe violations closed or open", async () => {
    render(<StalenessPopover />);
    expect(await componentAxeViolations()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Pinned version" }));

    expect(await componentAxeViolations()).toEqual([]);
  });
});
