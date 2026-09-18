import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { smoke } from "../../support/builders";
import {
  aDraftOf,
  isYes,
  itemList,
  lastPutItems,
  notes,
  optionLabels,
  perDay,
  placed,
  puts,
  renderEditor,
  rowOf,
  started,
} from "./harness";

afterEach(() => vi.restoreAllMocks());

describe("the draft editor's predicate editor", () => {
  it("lets a condition pick only earlier questions and only the operators the referenced type allows", async () => {
    const { requests } = renderEditor({
      draft: aDraftOf([
        placed("itm_smoke", smoke),
        placed("itm_per_day", perDay, { all: [isYes] }),
        placed("itm_started", started, { all: [isYes, { type: "number", itemId: "itm_per_day", op: "gte", value: 10 }] }),
        placed("itm_notes", notes),
      ]),
    });
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Rules for question 1" }));
    const firstRules = within(rowOf("itm_smoke"));
    expect(firstRules.getByRole("button", { name: "Add condition" })).toBeDisabled();
    expect(firstRules.getByText("The first question has no earlier answers to depend on.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Rules for question 3" }));
    const rules = within(rowOf("itm_started"));
    expect(optionLabels(rules.getByRole("combobox", { name: "Condition 2: question" }))).toEqual([
      "1. Do you smoke?",
      "2. How many a day?",
    ]);
    expect(optionLabels(rules.getByRole("combobox", { name: "Condition 1: operator" }))).toEqual([
      "is",
      "is not",
      "is any of",
      "is none of",
    ]);
    expect(optionLabels(rules.getByRole("combobox", { name: "Condition 2: operator" }))).toEqual([
      "equals",
      "does not equal",
      "is less than",
      "is at most",
      "is more than",
      "is at least",
      "is between",
    ]);
    expect(rules.getByText("cigarettes")).toBeInTheDocument();

    await userEvent.selectOptions(rules.getByRole("combobox", { name: "Condition 2: operator" }), "is between");
    await waitFor(() =>
      expect(puts(requests).at(-1)?.body).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            itemId: "itm_started",
            visibleWhen: { all: [isYes, { type: "number", itemId: "itm_per_day", op: "between", min: 10, max: 10 }] },
          }),
        ]),
      }),
    );

    const highest = rules.getByRole("textbox", { name: "Condition 2: value, highest" });
    await userEvent.clear(highest);
    await userEvent.type(highest, "25{Enter}");
    await waitFor(() => expect(puts(requests)).toHaveLength(2));
    expect((await lastPutItems(requests))[2]?.visibleWhen).toEqual({
      all: [isYes, { type: "number", itemId: "itm_per_day", op: "between", min: 10, max: 25 }],
    });
  });

  it("adds a condition on the nearest earlier question and switches to a many-option operator without losing the option", async () => {
    const { requests } = renderEditor({ draft: aDraftOf([placed("itm_smoke", smoke), placed("itm_notes", notes)]) });
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Rules for question 2" }));
    const rules = within(rowOf("itm_notes"));
    await userEvent.click(rules.getByRole("button", { name: "Add condition" }));
    expect((await lastPutItems(requests))[1]?.visibleWhen).toEqual({ all: [isYes] });

    await userEvent.selectOptions(rules.getByRole("combobox", { name: "Condition 1: operator" }), "is any of");
    await waitFor(() => expect(puts(requests)).toHaveLength(2));
    expect((await lastPutItems(requests))[1]?.visibleWhen).toEqual({
      all: [{ type: "single_choice", itemId: "itm_smoke", op: "isAnyOf", optionIds: ["yes"] }],
    });
    expect(rules.getByRole("checkbox", { name: "Yes" })).toBeDisabled();

    await userEvent.selectOptions(rules.getByRole("combobox", { name: "Which conditions must be true" }), "any");
    await waitFor(() => expect(puts(requests)).toHaveLength(3));
    expect((await lastPutItems(requests))[1]?.visibleWhen).toEqual({
      any: [{ type: "single_choice", itemId: "itm_smoke", op: "isAnyOf", optionIds: ["yes"] }],
    });
  });

  it("flags a condition that a reorder left pointing at a later question, in the row and in the picker", async () => {
    renderEditor({ draft: aDraftOf([placed("itm_per_day", perDay, { all: [isYes] }), placed("itm_smoke", smoke)]) });
    await itemList();

    expect(within(rowOf("itm_per_day")).getByText("A condition uses question 2, which is now below this question.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rules for question 1" }));
    const picker = within(rowOf("itm_per_day")).getByRole("combobox", { name: "Condition 1: question" });
    expect(picker).toHaveAttribute("aria-invalid", "true");
    expect(picker).toHaveAccessibleDescription(/Question 2 is now below this one/);
    const laterOption = within(picker).getByRole("option", { name: "2. Do you smoke? (now below this question)" });
    expect(laterOption).toBeDisabled();
    expect(within(picker).getAllByRole("option")).toHaveLength(1);
  });

  it("never writes a number condition the author did not enter: an unbounded question leaves the value empty until one is typed", async () => {
    const { requests } = renderEditor({
      draft: aDraftOf([placed("itm_smoke", smoke), placed("itm_per_day", perDay), placed("itm_started", started, { all: [isYes] })]),
    });
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Rules for question 3" }));
    const rules = within(rowOf("itm_started"));
    await userEvent.click(rules.getByRole("button", { name: "Add condition" }));

    const value = rules.getByRole("textbox", { name: "Condition 2: value" });
    expect(value).toHaveValue("");
    expect(value).toHaveAttribute("aria-invalid", "true");
    expect(value).toHaveAccessibleDescription(/Not saved yet. Enter a value to save this condition./);
    expect(rules.getByRole("button", { name: "Add condition" })).toBeDisabled();
    await userEvent.click(value);
    await userEvent.tab();
    expect(puts(requests)).toHaveLength(0);

    await userEvent.type(value, "12{Enter}");
    expect((await lastPutItems(requests))[2]?.visibleWhen).toEqual({
      all: [isYes, { type: "number", itemId: "itm_per_day", op: "eq", value: 12 }],
    });

    await userEvent.selectOptions(rules.getByRole("combobox", { name: "Condition 1: question" }), "2. How many a day?");
    expect(rules.getByRole("textbox", { name: "Condition 1: value" })).toHaveValue("");
    expect(puts(requests)).toHaveLength(1);
    await userEvent.type(rules.getByRole("textbox", { name: "Condition 1: value" }), "3{Enter}");
    await waitFor(() => expect(puts(requests)).toHaveLength(2));
    expect((await lastPutItems(requests))[2]?.visibleWhen).toEqual({
      all: [
        { type: "number", itemId: "itm_per_day", op: "eq", value: 3 },
        { type: "number", itemId: "itm_per_day", op: "eq", value: 12 },
      ],
    });
  });
});
