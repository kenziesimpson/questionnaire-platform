import type { ClientAnswers } from "@qp/shared";
import { axeViolations } from "@qp/ui/testing";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ErrorSummary, errorSummaryEntries, errorSummaryTitle, type ErrorSummaryEntry } from "../../src/screens/error-summary";
import { intakeV1 } from "../fixtures";

const yesBranch: ClientAnswers = { itm_01: { type: "single_choice", optionId: "yes" } };

describe("errorSummaryEntries", () => {
  it("lists shown items in form order with the catalogue message for their first code", () => {
    const entries = errorSummaryEntries(intakeV1, yesBranch, {
      itm_04: ["text/too-long", "answer/required"],
      itm_02: ["answer/required"],
    });

    expect(entries).toEqual([
      { itemId: "itm_02", prompt: "Which condition?", message: "Answer this question." },
      { itemId: "itm_04", prompt: "Preferred pharmacy", message: "Enter no more than 120 characters." },
    ]);
  });

  it("leaves out items the answers hide", () => {
    expect(errorSummaryEntries(intakeV1, { itm_01: { type: "single_choice", optionId: "no" } }, { itm_03: ["date/in-future"] })).toEqual([]);
  });
});

describe("errorSummaryTitle", () => {
  it.each([
    [0, "Your answers could not be submitted"],
    [1, "1 answer needs attention"],
    [3, "3 answers need attention"],
  ])("titles %i entries as %s", (count, title) => {
    expect(errorSummaryTitle(count)).toBe(title);
  });
});

const entries: ErrorSummaryEntry[] = [
  { itemId: "itm_02", prompt: "Which condition?", message: "Answer this question." },
  { itemId: "itm_04", prompt: "Preferred pharmacy", message: "Enter no more than 120 characters." },
];

function renderSummary(overrides: { entries?: ErrorSummaryEntry[]; unplacedErrors?: boolean; onJump?: (itemId: string) => void } = {}) {
  const onJump = overrides.onJump ?? vi.fn();
  const ref = createRef<HTMLElement>();
  render(<ErrorSummary ref={ref} entries={overrides.entries ?? entries} unplacedErrors={overrides.unplacedErrors ?? false} onJump={onJump} />);
  return { onJump };
}

describe("ErrorSummary", () => {
  it("titles the region by count and lists each entry as a jump button, in order", () => {
    renderSummary();

    const region = screen.getByRole("region", { name: "2 answers need attention" });
    expect(within(region).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Which condition? — Answer this question.",
      "Preferred pharmacy — Enter no more than 120 characters.",
    ]);
  });

  it("calls onJump with the item id when its entry is clicked", async () => {
    const user = userEvent.setup();
    const { onJump } = renderSummary();

    await user.click(screen.getByRole("button", { name: "Preferred pharmacy" }));

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith("itm_04");
  });

  it("shows the unplaced-errors note only when flagged, without a list when there are no entries", () => {
    renderSummary({ entries: [], unplacedErrors: true });

    const region = screen.getByRole("region", { name: "Your answers could not be submitted" });
    expect(within(region).queryByRole("listitem")).not.toBeInTheDocument();
    expect(region).toHaveTextContent("Some answers could not be accepted. Check your answers and submit again.");
  });

  it("finds no axe violations with entries listed", async () => {
    renderSummary();

    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations with only the unplaced note", async () => {
    renderSummary({ entries: [], unplacedErrors: true });

    expect(await axeViolations()).toEqual([]);
  });
});
