import { render, screen } from "@testing-library/react";
import { componentAxeViolations } from "@qp/ui/testing";
import { describe, expect, it } from "vitest";
import { InfoTip } from "../../src/components/info-tip";

describe("InfoTip", () => {
  it("is a labelled button that reveals its content on focus", async () => {
    render(<InfoTip label="About removing an archived question">Removing it keeps the rest of the draft.</InfoTip>);
    const trigger = screen.getByRole("button", { name: "About removing an archived question" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    trigger.focus();

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Removing it keeps the rest of the draft.");
    expect(trigger).toHaveAttribute("aria-describedby", tip.id);
  });

  it("finds no axe violations closed or open", async () => {
    render(<InfoTip label="About this note">Some detail.</InfoTip>);
    expect(await componentAxeViolations()).toEqual([]);

    screen.getByRole("button", { name: "About this note" }).focus();
    await screen.findByRole("tooltip");

    expect(await componentAxeViolations()).toEqual([]);
  });
});
