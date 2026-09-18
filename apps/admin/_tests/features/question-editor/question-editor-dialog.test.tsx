import { componentAxeViolations, jsonResponse, problemResponse, respondInOrder, stubFetch } from "@qp/ui/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUESTION_ID, aBankQuestion, aQuestionVersion } from "../../support/builders";
import { deferred } from "../../support/http";
import { inDialog, optionIdsShown, renderEditor } from "./harness";

afterEach(() => {
  vi.restoreAllMocks();
});

const GENERATED_ID = /^opt_[a-z0-9]{8}$/;

const typeRadio = (name: string) => inDialog().getByRole("radio", { name });
const field = (name: string) => inDialog().getByRole("textbox", { name });
const labelInputs = () => inDialog().queryAllByRole("textbox", { name: /^Label for / });

async function chooseType(name: string) {
  await userEvent.click(typeRadio(name));
}

async function typeInto(name: string, text: string) {
  const input = field(name);
  await userEvent.clear(input);
  if (text !== "") await userEvent.type(input, text);
  return input;
}

function layOutOptionRows() {
  const rowHeight = 40;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.closest("li[data-option-id]");
    const index = row?.parentElement === null || row === null ? 0 : Array.from(row.parentElement.children).indexOf(row);
    return new DOMRect(0, index * rowHeight, 400, rowHeight);
  });
}

const yesNoCheckbox = () => inDialog().queryByRole("checkbox", { name: "Yes / No question" });

function expectNoOptionListControls() {
  expect(inDialog().queryByRole("button", { name: "Add option" })).not.toBeInTheDocument();
  expect(inDialog().queryByRole("button", { name: /^Remove option/ })).not.toBeInTheDocument();
  expect(inDialog().queryByRole("button", { name: /^Reorder option/ })).not.toBeInTheDocument();
  expect(inDialog().queryByRole("checkbox", { name: /Allow a freeform/ })).not.toBeInTheDocument();
  expect(inDialog().queryByText("Freeform")).not.toBeInTheDocument();
}

async function clickSave() {
  await userEvent.click(inDialog().getByRole("button", { name: /^Save as version/ }));
}

describe("QuestionEditorDialog — fields per response type", () => {
  it("shows the fields for each of the five types and swaps them when the type changes", async () => {
    renderEditor();

    expect(typeRadio("Text")).toBeChecked();
    expect(field("Min length")).toBeInTheDocument();
    expect(field("Max length")).toBeInTheDocument();
    expect(inDialog().getByRole("checkbox", { name: "Multiline" })).toBeInTheDocument();
    expect(inDialog().queryByRole("group", { name: "Options" })).not.toBeInTheDocument();

    await chooseType("Single choice");
    expect(inDialog().getByRole("group", { name: "Options" })).toBeInTheDocument();
    expect(inDialog().getByRole("checkbox", { name: "Allow a freeform “Other” option" })).toBeInTheDocument();
    expect(inDialog().queryByRole("textbox", { name: "Min length" })).not.toBeInTheDocument();
    expect(inDialog().queryByRole("textbox", { name: "Min selections" })).not.toBeInTheDocument();

    await chooseType("Multiple choice");
    expect(inDialog().getByRole("group", { name: "Options" })).toBeInTheDocument();
    expect(field("Min selections")).toBeInTheDocument();
    expect(field("Max selections")).toBeInTheDocument();

    await chooseType("Number");
    expect(inDialog().getByRole("radio", { name: "Whole number" })).toBeChecked();
    expect(inDialog().getByRole("radio", { name: "Decimal" })).toBeInTheDocument();
    expect(field("Min")).toBeInTheDocument();
    expect(field("Max")).toBeInTheDocument();
    expect(field("Unit")).toBeInTheDocument();
    expect(inDialog().queryByRole("group", { name: "Options" })).not.toBeInTheDocument();

    await chooseType("Date");
    expect(inDialog().getByLabelText("Earliest")).toHaveAttribute("type", "date");
    expect(inDialog().getByLabelText("Latest")).toHaveAttribute("type", "date");
    expect(inDialog().getByRole("radio", { name: "Any" })).toBeChecked();
    expect(inDialog().getByRole("radio", { name: "Not in the future" })).toBeInTheDocument();
    expect(inDialog().getByRole("radio", { name: "Not in the past" })).toBeInTheDocument();
    expect(inDialog().queryByRole("textbox", { name: "Unit" })).not.toBeInTheDocument();
  });

  it("tells the author in create mode that only the response type is fixed, and carries no save notice", () => {
    renderEditor();

    expect(inDialog().getByRole("group", { name: "Response type" })).toHaveAccessibleDescription(
      "Response type cannot be changed later. Options, naming, and constraints can be modified later.",
    );
    expect(screen.getByRole("dialog", { name: "New question" })).not.toHaveAttribute("aria-describedby");
    expect(inDialog().queryByText(/Saving writes/)).not.toBeInTheDocument();
    expect(inDialog().queryByText("One save, one version.")).not.toBeInTheDocument();
  });

  it("names the version the save writes on the Save button in edit mode, with no notice", () => {
    renderEditor({ question: aQuestionVersion({ type: "text", questionVersion: 4 }) });

    expect(inDialog().getByRole("button", { name: "Save as version 5" })).toBeInTheDocument();
    expect(inDialog().queryByText(/Saving writes/)).not.toBeInTheDocument();
  });
});

describe("QuestionEditorDialog — field wiring the clamping unit tests do not cover", () => {
  it("number: letters cannot be typed into a bound", async () => {
    renderEditor();
    await chooseType("Number");
    await typeInto("Unit", "kg");

    await userEvent.type(field("Min"), "x");
    expect(field("Min")).toHaveValue("");
  });

  it("date: the latest field's min attribute tracks the earliest value", async () => {
    renderEditor();
    await chooseType("Date");
    const earliest = inDialog().getByLabelText("Earliest");
    const latest = inDialog().getByLabelText("Latest");

    fireEvent.change(earliest, { target: { value: "2026-06-01" } });
    expect(latest).toHaveAttribute("min", "2026-06-01");
  });
});

describe("QuestionEditorDialog — the remaining rules cannot be entered", () => {
  it("option ids are generated, never typed, and every added option gets a distinct id outside the reserved ones", async () => {
    renderEditor();
    await chooseType("Single choice");
    for (let added = 0; added < 6; added += 1) {
      await userEvent.click(inDialog().getByRole("button", { name: "Add option" }));
    }

    const ids = optionIdsShown();
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    ids.forEach((id) => expect(id).toMatch(GENERATED_ID));
    expect(inDialog().queryByRole("textbox", { name: /option id/i })).not.toBeInTheDocument();
  });

  it("only the Other row is freeform: no other row offers the mark, and the saved body carries it on `other` alone", async () => {
    const requests = stubFetch(() => jsonResponse(201, aBankQuestion(aQuestionVersion({ type: "single_choice", questionVersion: 1 }))));
    renderEditor();
    await chooseType("Single choice");
    await typeInto("Prompt", "PR2 Which condition?");
    await userEvent.type(labelInputs()[0]!, "Diabetes");
    await userEvent.click(inDialog().getByRole("checkbox", { name: "Allow a freeform “Other” option" }));

    const otherRow = inDialog().getByText("Freeform").closest("[data-option-id]");
    expect(otherRow).toHaveAttribute("data-option-id", "other");
    expect(inDialog().getAllByText("Freeform")).toHaveLength(1);

    await clickSave();

    await waitFor(() => expect(requests).toHaveLength(1));
    const body = requests[0]?.body as { question: { options: { optionId: string; freeform?: boolean }[] } };
    expect(body.question.options.filter((option) => option.freeform === true).map(({ optionId }) => optionId)).toEqual([
      "other",
    ]);
    expect(body.question.options.at(-1)).toEqual({ optionId: "other", label: "Other", freeform: true });
  });
});

describe("QuestionEditorDialog — option ids and the Yes / No template", () => {
  it("shows each option's id beside its row, and relabelling leaves the id untouched", async () => {
    renderEditor({ question: aQuestionVersion({ type: "single_choice" }) });

    expect(optionIdsShown()).toEqual(["opt_diabetes", "opt_hyperten"]);
    const [first] = inDialog().getAllByRole("listitem");
    expect(within(first!).getByText("opt_diabetes")).toBeInTheDocument();
    expect(within(first!).queryByDisplayValue("opt_diabetes")).not.toBeInTheDocument();

    const label = inDialog().getByRole("textbox", { name: "Label for opt_hyperten" });
    await userEvent.clear(label);
    await userEvent.type(label, "High blood pressure (hypertension)");

    expect(optionIdsShown()).toEqual(["opt_diabetes", "opt_hyperten"]);
    expect(label).toHaveAccessibleDescription(/opt_hyperten/);
  });

  it("offers the Yes / No checkbox above the prompt only while Single choice is selected, labelled and reachable by keyboard", async () => {
    renderEditor();

    expect(yesNoCheckbox()).not.toBeInTheDocument();
    for (const type of ["Multiple choice", "Number", "Date", "Text"]) {
      await chooseType(type);
      expect(yesNoCheckbox()).not.toBeInTheDocument();
    }

    await chooseType("Single choice");
    const checkbox = yesNoCheckbox();
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(checkbox).toHaveAccessibleDescription("Two options with the reserved ids yes and no. Their labels stay editable.");
    expect(checkbox!.compareDocumentPosition(field("Prompt")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    typeRadio("Single choice").focus();
    await userEvent.tab();
    expect(checkbox).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(checkbox).toBeChecked();
    expect(optionIdsShown()).toEqual(["yes", "no"]);
  });

  it("checked, limits the question to yes and no with editable labels and no add, remove, reorder or Other controls", async () => {
    const requests = stubFetch(() => jsonResponse(201, aBankQuestion(aQuestionVersion({ type: "single_choice", questionVersion: 1 }))));
    renderEditor();
    await chooseType("Single choice");

    await userEvent.click(yesNoCheckbox()!);

    expect(typeRadio("Single choice")).toBeChecked();
    expect(optionIdsShown()).toEqual(["yes", "no"]);
    expect(labelInputs().map((input) => (input as HTMLInputElement).value)).toEqual(["Yes", "No"]);
    expectNoOptionListControls();

    await typeInto("Label for yes", "True");
    await typeInto("Label for no", "False");
    await typeInto("Prompt", "PR2 The sky is blue");
    await clickSave();

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.body).toEqual({
      question: {
        type: "single_choice",
        prompt: "PR2 The sky is blue",
        options: [
          { optionId: "yes", label: "True" },
          { optionId: "no", label: "False" },
        ],
      },
    });
  });

  it("unchecked, restores the options and the Other choice the author had before", async () => {
    renderEditor();
    await chooseType("Single choice");
    await userEvent.type(labelInputs()[0]!, "Diabetes");
    await userEvent.click(inDialog().getByRole("button", { name: "Add option" }));
    await userEvent.type(labelInputs()[1]!, "Asthma");
    await userEvent.click(inDialog().getByRole("checkbox", { name: "Allow a freeform “Other” option" }));
    const before = optionIdsShown();

    await userEvent.click(yesNoCheckbox()!);
    expect(optionIdsShown()).toEqual(["yes", "no"]);
    await userEvent.click(yesNoCheckbox()!);

    expect(optionIdsShown()).toEqual(before);
    expect(labelInputs().map((input) => (input as HTMLInputElement).value)).toEqual(["Diabetes", "Asthma", "Other"]);
    expect(inDialog().getByRole("checkbox", { name: "Allow a freeform “Other” option" })).toBeChecked();
    expect(inDialog().getByRole("button", { name: "Add option" })).toBeInTheDocument();
  });

  it("unchecked with no options before, starts again from one blank option", async () => {
    renderEditor();
    await chooseType("Single choice");
    await userEvent.click(inDialog().getByRole("button", { name: /^Remove option/ }));
    await userEvent.click(yesNoCheckbox()!);

    await userEvent.click(yesNoCheckbox()!);

    expect(optionIdsShown()).toHaveLength(1);
    expect(optionIdsShown()[0]).toMatch(GENERATED_ID);
    expect(labelInputs()[0]).toHaveValue("");
  });

  it("never saves a yes / no question with `other`, even when Other was ticked before the checkbox, or after switching type and back", async () => {
    const requests = stubFetch(() => jsonResponse(201, aBankQuestion(aQuestionVersion({ type: "single_choice", questionVersion: 1 }))));
    renderEditor();
    await chooseType("Single choice");
    await typeInto("Prompt", "PR2 Any allergies?");
    await userEvent.type(labelInputs()[0]!, "Peanuts");
    await userEvent.click(inDialog().getByRole("checkbox", { name: "Allow a freeform “Other” option" }));

    await userEvent.click(yesNoCheckbox()!);
    expect(inDialog().queryByRole("checkbox", { name: "Allow a freeform “Other” option" })).not.toBeInTheDocument();
    await chooseType("Multiple choice");
    expect(optionIdsShown()).not.toContain("yes");
    await chooseType("Single choice");
    await userEvent.click(yesNoCheckbox()!);
    await clickSave();

    await waitFor(() => expect(requests).toHaveLength(1));
    const body = requests[0]?.body as { question: { options: { optionId: string }[] } };
    expect(body.question.options.map(({ optionId }) => optionId)).toEqual(["yes", "no"]);
  });

  it("in edit mode shows a saved yes / no question checked and disabled, in the limited format", () => {
    renderEditor({
      question: aQuestionVersion({
        type: "single_choice",
        options: [
          { optionId: "yes", label: "True" },
          { optionId: "no", label: "False" },
        ],
      }),
    });

    expect(yesNoCheckbox()).toBeChecked();
    expect(yesNoCheckbox()).toBeDisabled();
    expect(optionIdsShown()).toEqual(["yes", "no"]);
    expect(labelInputs()[0]).toHaveValue("True");
    expect(labelInputs()[0]).toBeEnabled();
    expectNoOptionListControls();
  });

  it.each([
    ["ordinary options", [{ optionId: "opt_diabetes", label: "Diabetes" }, { optionId: "opt_hyperten", label: "Hypertension" }]],
    ["yes and no plus Other", [{ optionId: "yes", label: "Yes" }, { optionId: "no", label: "No" }, { optionId: "other", label: "Other", freeform: true }]],
  ])("in edit mode shows a single choice question with %s unchecked and disabled, with its full options editor", (_, options) => {
    renderEditor({ question: aQuestionVersion({ type: "single_choice", options }) });

    expect(yesNoCheckbox()).not.toBeChecked();
    expect(yesNoCheckbox()).toBeDisabled();
    expect(inDialog().getByRole("button", { name: "Add option" })).toBeInTheDocument();
  });

  it("moves an option with the keyboard sensor and announces the move", async () => {
    layOutOptionRows();
    const question = aQuestionVersion({
      type: "single_choice",
      options: [
        { optionId: "opt_diabetes", label: "Diabetes" },
        { optionId: "opt_hyperten", label: "Hypertension" },
        { optionId: "opt_asthma", label: "Asthma" },
      ],
    });
    renderEditor({ question });

    const handle = inDialog().getByRole("button", { name: "Reorder option Diabetes" });
    handle.focus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(inDialog().getByRole("status")).toHaveTextContent("Picked up option Diabetes"));
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(inDialog().getByRole("status")).toHaveTextContent("moved to position 2 of 3"));
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard(" ");

    await waitFor(() => expect(optionIdsShown()).toEqual(["opt_hyperten", "opt_asthma", "opt_diabetes"]));
    expect(inDialog().getByRole("status")).toHaveTextContent("dropped in position 3 of 3");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels a keyboard drag on Escape without closing the dialog", async () => {
    layOutOptionRows();
    const { onOpenChange } = renderEditor({ question: aQuestionVersion({ type: "single_choice" }) });

    inDialog().getByRole("button", { name: "Reorder option Diabetes" }).focus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(inDialog().getByRole("status")).toHaveTextContent("Picked up option Diabetes"));
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(inDialog().getByRole("status")).toHaveTextContent("Reordering cancelled"));
    expect(optionIdsShown()).toEqual(["opt_diabetes", "opt_hyperten"]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("QuestionEditorDialog — the type lock", () => {
  it.each(["number", "single_choice"] as const)("disables every response type, and any Yes / No checkbox, when editing a saved %s question", (type) => {
    renderEditor({ question: aQuestionVersion({ type }) });

    for (const name of ["Text", "Single choice", "Multiple choice", "Number", "Date"]) {
      expect(typeRadio(name)).toBeDisabled();
    }
    expect(typeRadio(type === "number" ? "Number" : "Single choice")).toBeChecked();
    expect(yesNoCheckbox() === null || yesNoCheckbox()!.hasAttribute("disabled")).toBe(true);
    expect(inDialog().getByRole("group", { name: "Response type" })).toHaveAccessibleDescription("Response type cannot be changed.");
  });

  it("surfaces a 400 question/type-changed on the type row", async () => {
    stubFetch(
      respondInOrder(
        problemResponse("request/invalid", { errors: [{ pointer: "/body/question/type", code: "question/type-changed" }] }),
      ),
    );
    const { onSaved } = renderEditor({ question: aQuestionVersion({ type: "text" }) });

    await clickSave();

    const typeGroup = inDialog().getByRole("group", { name: "Response type" });
    await waitFor(() => expect(typeGroup).toHaveAccessibleDescription(/fixed when this question was first saved/));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("QuestionEditorDialog — saving", () => {
  it("creates with POST /questions, hands the new version to onSaved and closes", async () => {
    const created = aQuestionVersion({ type: "text", questionVersion: 1, prompt: "PR2 Preferred pharmacy", maxLength: 120 });
    const requests = stubFetch(respondInOrder(jsonResponse(201, aBankQuestion(created))));
    const { onSaved, onOpenChange } = renderEditor();

    await typeInto("Prompt", "PR2 Preferred pharmacy");
    await typeInto("Max length", "120");
    await userEvent.click(inDialog().getByRole("checkbox", { name: "Multiline" }));
    await clickSave();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "/api/definition/questions",
        body: { question: { type: "text", prompt: "PR2 Preferred pharmacy", maxLength: 120, multiline: true } },
      }),
    ]);
  });

  it("edits with POST /questions/:id/versions carrying the whole question, ids and order kept", async () => {
    const question = aQuestionVersion({ type: "multiple_choice", minSelections: 1 });
    const saved = { ...question, questionVersion: 4 };
    const requests = stubFetch(respondInOrder(jsonResponse(201, saved)));
    const { onSaved } = renderEditor({ question });

    await typeInto("Label for opt_hyperten", "High blood pressure (hypertension)");
    await typeInto("Max selections", "2");
    await clickSave();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: `/api/definition/questions/${QUESTION_ID}/versions`,
        body: {
          question: {
            type: "multiple_choice",
            prompt: "Which condition?",
            options: [
              { optionId: "opt_diabetes", label: "Diabetes" },
              { optionId: "opt_hyperten", label: "High blood pressure (hypertension)" },
            ],
            minSelections: 1,
            maxSelections: 2,
          },
        },
      }),
    ]);
  });

  it("disables saving while the request is in flight", async () => {
    const response = deferred<Response>();
    stubFetch(() => response.promise);
    const { onOpenChange } = renderEditor({ question: aQuestionVersion({ type: "text" }) });

    await clickSave();

    expect(await inDialog().findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(inDialog().getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    response.resolve(jsonResponse(201, aQuestionVersion({ type: "text", questionVersion: 4 })));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open with the author's changes and an alert when the save fails for a reason no field owns", async () => {
    stubFetch(respondInOrder(problemResponse("internal", { detail: "trace-1" })));
    const { onSaved } = renderEditor({ question: aQuestionVersion({ type: "text" }) });
    await typeInto("Prompt", "PR2 Reworded");

    await clickSave();

    expect(await inDialog().findByRole("alert")).toHaveTextContent("The question was not saved.");
    expect(field("Prompt")).toHaveValue("PR2 Reworded");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("maps a 400 request/invalid pointer onto the option row it names and moves focus there", async () => {
    stubFetch(
      respondInOrder(
        problemResponse("request/invalid", {
          errors: [
            { pointer: "/body/question/options/1/label", code: "schema/minLength" },
            { pointer: "/body/key", code: "schema/pattern" },
          ],
        }),
      ),
    );
    renderEditor({ question: aQuestionVersion({ type: "single_choice" }) });

    await clickSave();

    const label = inDialog().getByRole("textbox", { name: "Label for opt_hyperten" });
    await waitFor(() => expect(label).toHaveAttribute("aria-invalid", "true"));
    expect(label).toHaveAccessibleDescription(/schema\/minLength/);
    expect(label).toHaveFocus();
    expect(inDialog().getByRole("alert")).toHaveTextContent("schema/pattern");
  });

  it("does not send a question with an empty prompt or option label, and says which", async () => {
    const requests = stubFetch(() => jsonResponse(500, {}));
    renderEditor();
    await chooseType("Single choice");

    await clickSave();

    expect(field("Prompt")).toHaveAccessibleDescription("Enter the question's prompt.");
    expect(field("Prompt")).toHaveFocus();
    expect(labelInputs()[0]).toHaveAttribute("aria-invalid", "true");
    expect(requests).toHaveLength(0);
  });
});

describe("QuestionEditorDialog — accessibility", () => {
  it.each([
    ["creating a text question", {}],
    ["editing a choice question with Other", { question: aQuestionVersion({ type: "multiple_choice", options: [{ optionId: "opt_a", label: "A" }, { optionId: "other", label: "Other", freeform: true }] }) }],
    ["editing a number question", { question: aQuestionVersion({ type: "number" }) }],
    ["editing a yes / no question", { question: aQuestionVersion({ type: "single_choice", options: [{ optionId: "yes", label: "Yes" }, { optionId: "no", label: "No" }] }) }],
    ["editing a date question", { question: aQuestionVersion({ type: "date", relative: "not_future" }) }],
  ])("has no axe violations while %s", async (_, props) => {
    renderEditor(props);

    expect(await componentAxeViolations()).toEqual([]);
  });
});
