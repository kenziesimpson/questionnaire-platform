import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../../src/primitives/input-group";
import { axeViolations } from "../../src/testing";

function UnitInput() {
  return (
    <InputGroup>
      <InputGroupInput aria-label="Weight" inputMode="decimal" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>kg</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

describe("InputGroup", () => {
  it("groups a labelled input with its addon", () => {
    render(<UnitInput />);

    const input = screen.getByRole("textbox", { name: "Weight" });
    expect(screen.getAllByRole("group")[0]).toContainElement(input);
    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("focuses the input when its addon is clicked", async () => {
    render(<UnitInput />);

    await userEvent.click(screen.getByText("kg"));

    expect(screen.getByRole("textbox", { name: "Weight" })).toHaveFocus();
  });

  it("finds no axe violations", async () => {
    const { container } = render(<UnitInput />);

    expect(await axeViolations(container)).toEqual([]);
  });
});
