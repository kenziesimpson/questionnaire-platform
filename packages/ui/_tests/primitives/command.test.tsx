import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../../src/primitives/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../src/primitives/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../src/primitives/popover";
import { componentAxeViolations } from "../../src/testing";

const questions = [
  { value: "has-condition", label: "Do you have a medical condition?" },
  { value: "which-condition", label: "Which condition?" },
  { value: "pharmacy", label: "Which pharmacy do you use?" },
];

function QuestionCombobox({ onSelect = () => undefined }: { onSelect?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Earlier question">
          {questions.find((question) => question.value === value)?.label ?? "Choose a question"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" aria-label="Earlier questions">
        <Command label="Search questions">
          <CommandInput placeholder="Search questions" />
          <CommandList>
            <CommandEmpty>No question found.</CommandEmpty>
            <CommandGroup heading="Earlier questions">
              {questions.map((question) => (
                <CommandItem
                  key={question.value}
                  value={question.label}
                  onSelect={() => {
                    setValue(question.value);
                    setOpen(false);
                    onSelect(question.value);
                  }}
                >
                  {question.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

describe("Command in a Popover, the combobox pattern", () => {
  it("opens a searchable list of options from a combobox trigger", async () => {
    render(<QuestionCombobox />);
    const trigger = screen.getByRole("combobox", { name: "Earlier question" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Search questions" })).toHaveFocus();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(questions.map((question) => question.label));
  });

  it("filters the options as the author types, and says when nothing matches", async () => {
    render(<QuestionCombobox />);
    await userEvent.click(screen.getByRole("combobox", { name: "Earlier question" }));

    await userEvent.type(screen.getByRole("combobox", { name: "Search questions" }), "pharmacy");

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Which pharmacy do you use?"]);

    await userEvent.type(screen.getByRole("combobox", { name: "Search questions" }), "zzz");

    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByText("No question found.")).toBeInTheDocument();
  });

  it("selects an option from the keyboard and closes, showing the choice on the trigger", async () => {
    const onSelect = vi.fn();
    render(<QuestionCombobox onSelect={onSelect} />);
    const trigger = screen.getByRole("combobox", { name: "Earlier question" });
    await userEvent.click(trigger);

    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("which-condition");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("Which condition?");
  });

  it("finds no axe violations closed or open", async () => {
    render(<QuestionCombobox />);
    expect(await componentAxeViolations()).toEqual([]);

    await userEvent.click(screen.getByRole("combobox", { name: "Earlier question" }));

    expect(await componentAxeViolations()).toEqual([]);
  });
});
