import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Label } from "../../src/primitives/label";
import { NativeSelect, NativeSelectOption } from "../../src/primitives/native-select";
import { componentAxeViolations } from "../../src/testing";

function OperatorSelect({ onValueChange = () => undefined }: { onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState("before");
  return (
    <>
      <Label htmlFor="operator">Operator</Label>
      <NativeSelect
        id="operator"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onValueChange(event.target.value);
        }}
      >
        <NativeSelectOption value="before">is before</NativeSelectOption>
        <NativeSelectOption value="after">is after</NativeSelectOption>
      </NativeSelect>
    </>
  );
}

describe("NativeSelect", () => {
  it("is a select named by its label, reporting the chosen value", async () => {
    const onValueChange = vi.fn();
    render(<OperatorSelect onValueChange={onValueChange} />);
    const select = screen.getByRole("combobox", { name: "Operator" });
    expect(select).toHaveValue("before");

    await userEvent.selectOptions(select, "is after");

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("after");
    expect(select).toHaveValue("after");
  });

  it("disables the control, inside a wrapper styled to dim while it is disabled", () => {
    render(
      <NativeSelect disabled aria-label="Disabled select">
        <NativeSelectOption value="only">Only option</NativeSelectOption>
      </NativeSelect>,
    );

    const select = screen.getByRole("combobox", { name: "Disabled select" });
    expect(select).toBeDisabled();
    const wrapper = select.closest("[data-slot=\"native-select-wrapper\"]");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("has-[select:disabled]:opacity-50");
    expect(wrapper).toContainElement(select);
  });

  it("finds no axe violations", async () => {
    render(<OperatorSelect />);
    expect(await componentAxeViolations()).toEqual([]);
  });
});
