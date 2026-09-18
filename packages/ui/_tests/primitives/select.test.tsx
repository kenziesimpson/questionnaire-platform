import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Label } from "../../src/primitives/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../src/primitives/select";
import { componentAxeViolations } from "../../src/testing";

function OperatorSelect({ onValueChange = () => undefined }: { onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <>
      <Label htmlFor="operator">Operator</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      >
        <SelectTrigger id="operator">
          <SelectValue placeholder="Choose an operator" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Date operators</SelectLabel>
            <SelectItem value="before">is before</SelectItem>
            <SelectItem value="after">is after</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}

describe("Select", () => {
  it("is a combobox named by its label, showing the placeholder until a value is chosen", () => {
    render(<OperatorSelect />);

    const trigger = screen.getByRole("combobox", { name: "Operator" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Choose an operator");
  });

  it("opens a listbox of options from the keyboard and reports the chosen value", async () => {
    const onValueChange = vi.fn();
    render(<OperatorSelect onValueChange={onValueChange} />);
    const trigger = screen.getByRole("combobox", { name: "Operator" });
    trigger.focus();

    await userEvent.keyboard("{Enter}");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["is before", "is after"]);

    await userEvent.click(screen.getByRole("option", { name: "is after" }));

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("after");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("is after");
  });

  it("finds no axe violations closed or open", async () => {
    render(<OperatorSelect />);
    expect(await componentAxeViolations()).toEqual([]);

    screen.getByRole("combobox", { name: "Operator" }).focus();
    await userEvent.keyboard("{Enter}");

    expect(await componentAxeViolations()).toEqual([]);
  });
});
