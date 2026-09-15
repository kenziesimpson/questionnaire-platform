import type { VersionSummary } from "@qp/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QUESTIONNAIRE_ID, deferred, draftResponse, etagAt, jsonResponse, problemResponse } from "../fixtures";
import {
  DEFINITION,
  DRAFT_URL,
  VALIDATE_URL,
  LIST_URL,
  PUBLISH_URL,
  aDraftOf,
  alcohol,
  isYes,
  itemList,
  lastPutItems,
  notes,
  optionLabels,
  perDay,
  placed,
  promptsInOrder,
  puts,
  renderEditor,
  rowOf,
  smoke,
  standardDraft,
  started,
  summary,
  uuid,
} from "./draft-editor/harness";
import { aBankQuestion, aQuestionVersion, axeViolations, fillJsdomLayoutGaps } from "./question-editor/harness";

beforeAll(fillJsdomLayoutGaps);
afterEach(() => vi.restoreAllMocks());

describe("the draft editor", () => {
  it("shows a loading status, then the items in order with prompt, type, pinned version and visibility", async () => {
    renderEditor();

    expect(await screen.findByText("Loading draft…")).toHaveAttribute("role", "status");
    expect(await promptsInOrder()).toEqual(["Do you smoke?", "How many a day?", "When did you start?", "Anything else?"]);
    expect(screen.getByRole("heading", { level: 1, name: "Smoking history" })).toBeInTheDocument();
    expect(within(rowOf("itm_per_day")).getByText("Number · pinned v2 · Shown when 1 condition is true")).toBeInTheDocument();
    expect(within(rowOf("itm_notes")).getByText("Text · pinned v1 · Always shown")).toBeInTheDocument();
    expect(screen.getByText("published v2 · publishing creates v3")).toBeInTheDocument();
  });

  it("adds a bank question pinned to the version the picker showed, and marks questions already placed", async () => {
    const { requests } = renderEditor();
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a question" });
    const bankList = await within(dialog).findByRole("list", { name: "Active questions in the bank" });
    expect(within(bankList).getAllByText("In this draft")).toHaveLength(4);
    await userEvent.click(within(dialog).getByRole("button", { name: "Add “Units of alcohol a week?”, version 4" }));

    const items = await lastPutItems(requests);
    expect(puts(requests)[0]?.headers.get("if-match")).toBe(etagAt(1));
    expect(items).toHaveLength(5);
    expect(items[4]).toEqual({
      itemId: expect.stringMatching(/^itm_[a-z0-9]{8}$/),
      required: true,
      visibleWhen: null,
      questionId: alcohol.questionId,
      questionVersion: 4,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await promptsInOrder()).toContain("Units of alcohol a week?");
  });

  it("creates a question from inside the picker, adds it pinned to the version just written, and closes the picker", async () => {
    const created = aQuestionVersion({ type: "text", questionId: uuid(106), questionVersion: 1, prompt: "Any allergies?" });
    const { requests } = renderEditor({
      overrides: { [`POST ${DEFINITION}/questions`]: () => jsonResponse(201, aBankQuestion(created)) },
    });
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    const picker = await screen.findByRole("dialog", { name: "Add a question" });
    await within(picker).findByRole("list", { name: "Active questions in the bank" });
    await userEvent.click(within(picker).getByRole("button", { name: "New question" }));
    const editor = await screen.findByRole("dialog", { name: "New question" });
    await userEvent.type(within(editor).getByRole("textbox", { name: "Prompt" }), "Any allergies?");
    await userEvent.click(within(editor).getByRole("button", { name: "Save as version 1" }));

    expect((await lastPutItems(requests)).at(-1)).toEqual({
      itemId: expect.stringMatching(/^itm_[a-z0-9]{8}$/),
      required: true,
      visibleWhen: null,
      questionId: created.questionId,
      questionVersion: 1,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await promptsInOrder()).toHaveLength(5);
    expect(requests.filter(({ method, url }) => method === "POST" && url === `${DEFINITION}/questions`)).toHaveLength(1);
  });

  it("offers New question in the picker's empty state", async () => {
    renderEditor({ bank: [] });
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    const picker = await screen.findByRole("dialog", { name: "Add a question" });
    expect(await within(picker).findByText("The bank has no active questions yet")).toBeInTheDocument();
    await userEvent.click(within(picker).getByRole("button", { name: "New question" }));
    expect(await screen.findByRole("dialog", { name: "New question" })).toBeInTheDocument();
  });

  it("reorders from the keyboard through the drag handle: labelled, described, announced, and cancellable", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const row = this.closest("li[data-item-id]");
      const index = row === null || row.parentElement === null ? 0 : Array.from(row.parentElement.children).indexOf(row);
      return new DOMRect(0, index * 60, 600, 60);
    });
    const { requests } = renderEditor();
    await itemList();

    expect(screen.queryByRole("button", { name: /^Move question/ })).not.toBeInTheDocument();
    const handle = screen.getByRole("button", { name: "Drag to reorder question 1" });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle).toHaveAccessibleDescription(/press Space or Enter to pick up the question/);

    handle.focus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(screen.getByText(/Picked up question “Do you smoke\?”. It is in position 1 of 4./)).toBeInTheDocument());
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByText(/moved to position 2 of 4/)).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByText(/Reordering cancelled/)).toBeInTheDocument());
    expect(puts(requests)).toHaveLength(0);

    screen.getByRole("button", { name: "Drag to reorder question 1" }).focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard(" ");

    await waitFor(() => expect(screen.getByText(/was dropped in position 3 of 4/)).toBeInTheDocument());
    expect((await lastPutItems(requests)).map(({ itemId }) => itemId)).toEqual(["itm_per_day", "itm_started", "itm_smoke", "itm_notes"]);
    expect(await promptsInOrder()).toEqual(["How many a day?", "When did you start?", "Do you smoke?", "Anything else?"]);
  });

  it("asks before removing a question other conditions use, then removes it with those conditions", async () => {
    const { requests } = renderEditor();
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Remove question 4" }));
    expect((await lastPutItems(requests)).map(({ itemId }) => itemId)).toEqual(["itm_smoke", "itm_per_day", "itm_started"]);

    await userEvent.click(screen.getByRole("button", { name: "Remove question 1" }));
    expect(within(rowOf("itm_smoke")).getByRole("alert")).toHaveTextContent("Conditions on question 2 use this question.");
    expect(puts(requests)).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Remove question and conditions" }));

    await waitFor(() => expect(puts(requests)).toHaveLength(2));
    expect(await lastPutItems(requests)).toEqual([placed("itm_per_day", perDay), placed("itm_started", started)]);
  });

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

  it("edits a placed question from the bank's latest version and re-pins the item to the version the save wrote", async () => {
    const latest = { ...notes, questionVersion: 3, prompt: "Anything else to add?" };
    const saved = { ...latest, questionVersion: 4, prompt: "Anything else to add today?" };
    const { requests } = renderEditor({
      bank: [aBankQuestion(smoke), aBankQuestion(perDay), aBankQuestion(started), aBankQuestion(latest)],
      overrides: {
        [`POST ${DEFINITION}/questions/${notes.questionId}/versions`]: () => jsonResponse(201, saved),
      },
    });
    await itemList();

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit question 4" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Edit question 4" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit question" });
    expect(within(dialog).getByText("version 3")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Prompt" })).toHaveValue("Anything else to add?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save as version 4" }));

    const items = await lastPutItems(requests);
    expect(items[3]).toEqual({ ...placed("itm_notes", notes), questionVersion: 4 });
    expect(items.slice(0, 3).map(({ questionVersion }) => questionVersion)).toEqual([1, 2, 1]);
    expect(requests.some(({ method, url }) => method === "GET" && url === `${DEFINITION}/questions/${notes.questionId}`)).toBe(false);
  });

  it("marks a pin the bank has moved past as Newer version available in a right-aligned group, and re-pins on request", async () => {
    const newer = { ...started, questionVersion: 3, prompt: "When did you first start?" };
    const { requests } = renderEditor({ bank: [aBankQuestion(smoke), aBankQuestion(perDay), aBankQuestion(newer), aBankQuestion(notes)] });
    await itemList();

    const row = within(rowOf("itm_started"));
    const badge = await row.findByText("Newer version available");
    expect(badge.parentElement).toHaveClass("justify-end");
    expect(within(rowOf("itm_smoke")).queryByText("Newer version available")).not.toBeInTheDocument();
    await userEvent.click(row.getByRole("button", { name: "Re-pin question 3 to version 3" }));

    expect((await lastPutItems(requests))[2]).toEqual({ ...placed("itm_started", started), questionVersion: 3 });
  });

  it("shows no archived badge, no re-pin and no edit for an archived question, even when the bank holds a newer version", async () => {
    const newer = { ...started, questionVersion: 3 };
    const { requests } = renderEditor({
      bank: [aBankQuestion(smoke), aBankQuestion(perDay), { ...aBankQuestion(newer), archivedAt: "2026-09-14T11:00:00.000Z" }, aBankQuestion(notes)],
    });
    await itemList();

    const row = within(rowOf("itm_started"));
    await waitFor(() => expect(row.getByRole("button", { name: "Edit question 3" })).toBeDisabled());
    expect(within(rowOf("itm_smoke")).getByRole("button", { name: "Edit question 1" })).toBeEnabled();
    expect(row.queryByText("Newer version available")).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: /^Re-pin/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/archived/i)).not.toBeInTheDocument();
    expect(puts(requests)).toHaveLength(0);
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

  it("asks before removing an archived question, with an info note on hover and focus that it cannot be added back", async () => {
    const { requests } = renderEditor({
      bank: [aBankQuestion(smoke), aBankQuestion(perDay), aBankQuestion(started), { ...aBankQuestion(notes), archivedAt: "2026-09-14T11:00:00.000Z" }],
    });
    await itemList();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit question 4" })).toBeDisabled());

    await userEvent.click(screen.getByRole("button", { name: "Remove question 4" }));
    const confirmation = within(rowOf("itm_notes")).getByRole("alert");
    expect(confirmation).toHaveTextContent("Remove this question from the draft?");
    expect(puts(requests)).toHaveLength(0);

    const info = within(confirmation).getByRole("button", { name: "About removing an archived question" });
    expect(info).toHaveAccessibleDescription(
      "This question is archived in the question bank, so it cannot be added back once removed. Writing it again makes a new question, and its answers are not tracked together with this one's.",
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await userEvent.hover(info);
    expect(screen.getByRole("tooltip")).toHaveTextContent("cannot be added back once removed");
    await userEvent.unhover(info);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => info.focus());
    expect(screen.getByRole("tooltip")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);

    await userEvent.click(within(confirmation).getByRole("button", { name: "Remove question" }));
    expect((await lastPutItems(requests)).map(({ itemId }) => itemId)).toEqual(["itm_smoke", "itm_per_day", "itm_started"]);
  });

  it("on 409 draft-stale says someone else changed the draft and shows the reloaded draft", async () => {
    const theirs = aDraftOf([placed("itm_notes", notes), placed("itm_smoke", smoke)]);
    let reloaded = false;
    const { requests } = renderEditor({
      overrides: {
        [`PUT ${DRAFT_URL}`]: () => {
          reloaded = true;
          return problemResponse("questionnaire/draft-stale");
        },
        [`GET ${DRAFT_URL}`]: () => draftResponse(reloaded ? theirs : standardDraft, reloaded ? 5 : 1),
      },
    });
    await itemList();

    await userEvent.click(within(rowOf("itm_smoke")).getByRole("checkbox", { name: "Required" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Someone else changed this draft");
    expect(alert).toHaveTextContent("Your last change was undone and the draft has been reloaded with their version");
    expect(alert).not.toHaveTextContent("nothing you did was written");
    await waitFor(async () => expect(await promptsInOrder()).toEqual(["Anything else?", "Do you smoke?"]));
    expect(requests.filter(({ method, url }) => method === "GET" && url === DRAFT_URL)).toHaveLength(2);
    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("on 422 draft-invalid for a question archived while the picker was open, says the change was not saved, names it by catalogue title, rolls back and never blames another author", async () => {
    const { requests } = renderEditor({
      overrides: {
        [`PUT ${DRAFT_URL}`]: ({ body }) => {
          const items: { itemId: string }[] =
            body !== null && typeof body === "object" && "items" in body && Array.isArray(body.items) ? body.items : [];
          return problemResponse("questionnaire/draft-invalid", {
            items: [{ itemId: items.at(-1)?.itemId ?? "", code: "draft/question-archived" }],
          });
        },
      },
    });
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a question" });
    await within(dialog).findByRole("list", { name: "Active questions in the bank" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add “Units of alcohol a week?”, version 4" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your last change was not saved");
    expect(alert).toHaveAttribute("data-problem", "questionnaire/draft-invalid");
    expect(within(alert).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "The question being added · Archived in the question bank",
    ]);
    expect(alert).not.toHaveTextContent(/draft\/|questionnaire\/|422/);
    expect(within(alert).queryByRole("button", { name: "Show problems" })).not.toBeInTheDocument();
    expect(alert).toHaveTextContent("not another author's edit");
    expect(alert).not.toHaveTextContent(/someone else/i);
    expect(await promptsInOrder()).toEqual(["Do you smoke?", "How many a day?", "When did you start?", "Anything else?"]);
    expect(puts(requests)).toHaveLength(1);
    expect(requests.filter(({ method, url }) => method === "GET" && url === DRAFT_URL)).toHaveLength(1);
  });

  it("publishes with the draft's ETag and opens version history", async () => {
    const published: VersionSummary = {
      questionnaireId: QUESTIONNAIRE_ID,
      version: 3,
      publishedAt: "2026-09-14T10:00:00.000Z",
      publishedBy: null,
      itemCount: 4,
      formatVersion: 1,
    };
    const { requests, router } = renderEditor({
      overrides: {
        [`POST ${PUBLISH_URL}`]: () => jsonResponse(201, published),
        [`GET ${DEFINITION}/questionnaires/${QUESTIONNAIRE_ID}/versions`]: () => jsonResponse(200, [published]),
      },
    });
    await itemList();
    await within(screen.getByRole("region", { name: "Publish checks" })).findByText(/No problems found/);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/questionnaires/${QUESTIONNAIRE_ID}/versions`));
    const publishRequest = requests.find(({ method, url }) => method === "POST" && url === PUBLISH_URL);
    expect(publishRequest?.headers.get("if-match")).toBe(etagAt(1));
  });

  it("tells a publish refused as invalid apart from a stale conflict", async () => {
    renderEditor({
      overrides: {
        [`POST ${PUBLISH_URL}`]: () =>
          problemResponse("questionnaire/draft-invalid", { items: [{ itemId: "itm_smoke", code: "draft/unreachable" }] }),
      },
    });
    await itemList();
    await within(screen.getByRole("region", { name: "Publish checks" })).findByText(/No problems found/);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The draft was not published");
    expect(alert).toHaveTextContent("Question 1 · Can never be reached");
    expect(alert).not.toHaveTextContent(/someone else/i);
  });

  it("keeps Publish disabled while a change is saving and while the checks rerun on it, so an earlier green result cannot publish", async () => {
    const put = deferred<Response>();
    const recheck = deferred<Response>();
    let validations = 0;
    const { requests } = renderEditor({
      overrides: {
        [`PUT ${DRAFT_URL}`]: () => put.promise,
        [`POST ${VALIDATE_URL}`]: () => {
          validations += 1;
          return validations === 1 ? jsonResponse(200, { valid: true, items: [] }) : recheck.promise;
        },
      },
    });
    await itemList();
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toBeEnabled());

    await userEvent.click(within(rowOf("itm_smoke")).getByRole("checkbox", { name: "Required" }));
    await waitFor(() => expect(publish).toBeDisabled());
    expect(publish).toHaveAccessibleDescription("Publishing waits until your changes are saved.");

    put.resolve(draftResponse(standardDraft, 2));
    await waitFor(() => expect(validations).toBe(2));
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription("Publishing waits until Publish checks have run on the saved draft.");
    await userEvent.click(publish);
    expect(requests.some(({ method, url }) => method === "POST" && url === PUBLISH_URL)).toBe(false);

    recheck.resolve(jsonResponse(200, { valid: true, items: [] }));
    await waitFor(() => expect(publish).toBeEnabled());
  });

  it("locks every draft control while a publish is in flight, then says a refused publish was not published", async () => {
    const published = deferred<Response>();
    const { requests } = renderEditor({ overrides: { [`POST ${PUBLISH_URL}`]: () => published.promise } });
    await itemList();
    await userEvent.click(screen.getByRole("button", { name: "Rules for question 2" }));
    const publish = screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(publish).toBeEnabled());

    await userEvent.click(publish);

    await waitFor(() => expect(screen.getByRole("button", { name: "Publishing…" })).toBeDisabled());
    const second = within(rowOf("itm_per_day"));
    expect(second.getByRole("checkbox", { name: "Required" })).toBeDisabled();
    expect(second.getByRole("button", { name: "Drag to reorder question 2" })).toBeDisabled();
    expect(second.getByRole("button", { name: "Edit question 2" })).toBeDisabled();
    expect(second.getByRole("button", { name: "Remove question 2" })).toBeDisabled();
    expect(second.getByRole("combobox", { name: "Condition 1: operator" })).toBeDisabled();
    expect(second.getByRole("button", { name: "Add condition" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add question" })).toBeDisabled();

    published.resolve(problemResponse("questionnaire/draft-invalid", { items: [{ itemId: "itm_per_day", code: "predicate/unsatisfiable" }] }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The draft was not published");
    expect(alert).toHaveTextContent("Question 2 · Rules can never be met");
    await waitFor(() => expect(second.getByRole("checkbox", { name: "Required" })).toBeEnabled());
    expect(puts(requests)).toHaveLength(0);
  });

  it("with no open draft offers to open the next one, which loads the editor", async () => {
    const opened = aDraftOf([placed("itm_smoke", smoke)]);
    const { requests } = renderEditor({
      overrides: {
        [`GET ${DRAFT_URL}`]: () => problemResponse("resource/not-found"),
        [`GET ${LIST_URL}`]: () => jsonResponse(200, [{ ...summary, hasDraft: false }]),
        [`POST ${DRAFT_URL}`]: () => draftResponse(opened, 1, 201),
      },
    });

    expect(await screen.findByText("Smoking history has no open draft.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open the next draft" }));

    expect(await promptsInOrder()).toEqual(["Do you smoke?"]);
    expect(requests.some(({ method, url }) => method === "POST" && url === DRAFT_URL)).toBe(true);
  });

  it("says a questionnaire that is not listed does not exist", async () => {
    renderEditor({
      overrides: {
        [`GET ${DRAFT_URL}`]: () => problemResponse("resource/not-found"),
        [`GET ${LIST_URL}`]: () => jsonResponse(200, []),
      },
    });
    expect(await screen.findByText("This questionnaire does not exist.")).toBeInTheDocument();
  });

  it("shows an alert on a failed load whose Try again loads the draft", async () => {
    let attempts = 0;
    renderEditor({
      overrides: {
        [`GET ${DRAFT_URL}`]: () => {
          attempts += 1;
          return attempts === 1 ? problemResponse("internal", { detail: "trace-1" }) : draftResponse(standardDraft, 1);
        },
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The draft could not be loaded.");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await promptsInOrder()).toHaveLength(4);
  });

  it("has no axe violations with rules open, a conflict notice and publish problems showing, or in the bank picker", async () => {
    renderEditor({
      overrides: { [`PUT ${DRAFT_URL}`]: () => problemResponse("questionnaire/draft-stale") },
      validation: { valid: false, items: [{ itemId: "itm_per_day", code: "predicate/unsatisfiable" }] },
    });
    await itemList();
    await userEvent.click(screen.getByRole("button", { name: "Rules for question 2" }));
    await userEvent.click(within(rowOf("itm_smoke")).getByRole("checkbox", { name: "Required" }));
    await screen.findByRole("alert");
    expect(await axeViolations()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    await within(await screen.findByRole("dialog")).findByRole("list", { name: "Active questions in the bank" });
    expect(await axeViolations()).toEqual([]);
  });
});
