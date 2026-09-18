import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../src/primitives/tooltip";
import { componentAxeViolations } from "../../src/testing";

function InfoTooltip() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger type="button" aria-label="About this field">
          i
        </TooltipTrigger>
        <TooltipContent>Extra detail about this field.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("Tooltip", () => {
  it("opens on hover, naming itself via aria-describedby", async () => {
    render(<InfoTooltip />);
    const trigger = screen.getByRole("button", { name: "About this field" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.hover(trigger);

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Extra detail about this field.");
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
  });

  it("opens on focus, naming itself via aria-describedby", async () => {
    render(<InfoTooltip />);
    const trigger = screen.getByRole("button", { name: "About this field" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    trigger.focus();

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Extra detail about this field.");
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
  });

  it("closes on Escape", async () => {
    render(<InfoTooltip />);
    const trigger = screen.getByRole("button", { name: "About this field" });
    trigger.focus();
    await screen.findByRole("tooltip");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("finds no axe violations closed or open", async () => {
    render(<InfoTooltip />);
    expect(await componentAxeViolations()).toEqual([]);

    screen.getByRole("button", { name: "About this field" }).focus();
    await screen.findByRole("tooltip");

    expect(await componentAxeViolations()).toEqual([]);
  });
});
