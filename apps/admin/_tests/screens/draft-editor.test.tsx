import type { DraftItem, Question, QuestionVersion, QuestionnaireDraft, QuestionnaireSummary, VersionSummary } from "@qp/shared";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app";
import { createAppRouter } from "../../src/router";
import {
  QUESTIONNAIRE_ID,
  VERSION_ID,
  deferred,
  draftResponse,
  etagAt,
  jsonResponse,
  problemResponse,
  stubFetch,
  testQueryClient,
  type RecordedRequest,
} from "../fixtures";
import { aBankQuestion, aQuestionVersion, axeViolations, fillJsdomLayoutGaps } from "./question-editor/harness";

beforeAll(fillJsdomLayoutGaps);
afterEach(() => vi.restoreAllMocks());

const DEFINITION = "/api/definition";
const DRAFT_URL = `${DEFINITION}/questionnaires/${QUESTIONNAIRE_ID}/draft`;
const VALIDATE_URL = `${DRAFT_URL}/validate`;
const PUBLISH_URL = `${DEFINITION}/questionnaires/${QUESTIONNAIRE_ID}/publish`;
const LIST_URL = `${DEFINITION}/questionnaires`;
const BANK_URL = `${DEFINITION}/questions?includeArchived=true`;
const ACTIVE_BANK_URL = `${DEFINITION}/questions?includeArchived=false`;

const uuid = (n: number) => `01a0950e-56a0-73d6-b936-4a1e10eff${String(n).padStart(3, "0")}`;

const smoke = aQuestionVersion({
  type: "single_choice",
  questionId: uuid(101),
  questionVersion: 1,
  prompt: "Do you smoke?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
});
const perDay = aQuestionVersion({
  type: "number",
  questionId: uuid(102),
  questionVersion: 2,
  prompt: "How many a day?",
  unit: "cigarettes",
});
const started = aQuestionVersion({ type: "date", questionId: uuid(103), questionVersion: 1, prompt: "When did you start?" });
const notes = aQuestionVersion({ type: "text", questionId: uuid(104), questionVersion: 1, prompt: "Anything else?" });
const alcohol = aQuestionVersion({ type: "number", questionId: uuid(105), questionVersion: 4, prompt: "Units of alcohol a week?" });

const isYes = { type: "single_choice", itemId: "itm_smoke", op: "is", optionId: "yes" } as const;

function placed(itemId: string, question: QuestionVersion, visibleWhen: DraftItem["visibleWhen"] = null): DraftItem {
  return { itemId, required: true, visibleWhen, questionId: question.questionId, questionVersion: question.questionVersion };
}

const pool = [smoke, perDay, started, notes, alcohol];

function aDraftOf(items: DraftItem[]): QuestionnaireDraft {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    versionId: VERSION_ID,
    title: "Smoking history",
    updatedAt: "2026-09-14T09:00:00.000Z",
    items,
    questions: pool.filter((question) =>
      items.some((item) => item.questionId === question.questionId && item.questionVersion === question.questionVersion),
    ),
  };
}

const standardDraft = aDraftOf([
  placed("itm_smoke", smoke),
  placed("itm_per_day", perDay, { all: [isYes] }),
  placed("itm_started", started),
  placed("itm_notes", notes),
]);

const summary: QuestionnaireSummary = {
  questionnaireId: QUESTIONNAIRE_ID,
  key: null,
  name: "Smoking history",
  currentVersion: 2,
  closesAt: null,
  hasDraft: true,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-14T09:00:00.000Z",
};

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

interface Setup {
  draft?: QuestionnaireDraft;
  bank?: Question[];
  validation?: { valid: boolean; items: { itemId: string; code: string }[] };
  overrides?: Record<string, Handler>;
}

function echoSaved(revision: { current: number }): Handler {
  return ({ body }) => {
    revision.current += 1;
    const items: DraftItem[] = body !== null && typeof body === "object" && "items" in body && Array.isArray(body.items) ? body.items : [];
    return draftResponse(aDraftOf(items), revision.current);
  };
}

function renderEditor({ draft = standardDraft, bank = pool.map(aBankQuestion), validation = { valid: true, items: [] }, overrides = {} }: Setup = {}) {
  const revision = { current: 1 };
  const routes: Record<string, Handler> = {
    [`GET ${DRAFT_URL}`]: () => draftResponse(draft, revision.current),
    [`PUT ${DRAFT_URL}`]: echoSaved(revision),
    [`POST ${VALIDATE_URL}`]: () => jsonResponse(200, validation),
    [`GET ${LIST_URL}`]: () => jsonResponse(200, [summary]),
    [`GET ${BANK_URL}`]: () => jsonResponse(200, bank),
    [`GET ${ACTIVE_BANK_URL}`]: () => jsonResponse(200, bank.filter((question) => question.archivedAt === null)),
    ...overrides,
  };
  const requests = stubFetch((request) => {
    const respond = routes[`${request.method} ${request.url}`];
    return respond ? respond(request) : problemResponse("resource/not-found");
  });
  const queryClient = testQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [`/admin/questionnaires/${QUESTIONNAIRE_ID}/draft`] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { requests, router };
}

const itemList = () => screen.findByRole("list", { name: "Questions, in the order respondents see them" });

async function promptsInOrder() {
  const rows = within(await itemList()).getAllByRole("listitem").filter((row) => row.hasAttribute("data-item-id"));
  return rows.map((row) => row.querySelector(".font-medium")?.textContent);
}

function puts(requests: RecordedRequest[]) {
  return requests.filter(({ method, url }) => method === "PUT" && url === DRAFT_URL);
}

async function lastPutItems(requests: RecordedRequest[]): Promise<DraftItem[]> {
  await waitFor(() => expect(puts(requests).length).toBeGreaterThan(0));
  const body = puts(requests).at(-1)?.body;
  return body !== null && typeof body === "object" && "items" in body && Array.isArray(body.items) ? body.items : [];
}

function rowOf(itemId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`li[data-item-id="${itemId}"]`);
  if (row === null) throw new Error(`no row for ${itemId}`);
  return row;
}

function optionLabels(select: HTMLElement) {
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  return Array.from(select.options).map((option) => option.textContent);
}

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

  it("offers no re-pin and no edit for an archived question, even when the bank holds a newer version", async () => {
    const newer = { ...started, questionVersion: 3 };
    const { requests } = renderEditor({
      bank: [aBankQuestion(smoke), aBankQuestion(perDay), { ...aBankQuestion(newer), archivedAt: "2026-09-14T11:00:00.000Z" }, aBankQuestion(notes)],
    });
    await itemList();

    const row = within(rowOf("itm_started"));
    const archived = await row.findByText("Archived in bank");
    expect(archived.parentElement).toHaveClass("justify-end");
    expect(row.queryByText("Newer version available")).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: /^Re-pin/ })).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: "Edit question 3" })).toBeDisabled();
    expect(within(rowOf("itm_smoke")).getByRole("button", { name: "Edit question 1" })).toBeEnabled();
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

  it("on 422 draft-invalid says the draft cannot be saved, lists the refused items, rolls back and never blames another author", async () => {
    const { requests } = renderEditor({
      overrides: {
        [`PUT ${DRAFT_URL}`]: () =>
          problemResponse("questionnaire/draft-invalid", { items: [{ itemId: "itm_notes", code: "draft/question-archived" }] }),
      },
    });
    await itemList();

    await userEvent.click(within(rowOf("itm_smoke")).getByRole("checkbox", { name: "Required" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This draft cannot be saved right now");
    expect(alert).toHaveTextContent("Question 4 · draft/question-archived");
    expect(alert).toHaveTextContent("not another author's edit");
    expect(alert).not.toHaveTextContent(/someone else/i);
    expect(await promptsInOrder()).toEqual(["Do you smoke?", "How many a day?", "When did you start?", "Anything else?"]);
    expect(within(rowOf("itm_smoke")).getByRole("checkbox", { name: "Required" })).toBeChecked();
    expect(requests.filter(({ method, url }) => method === "GET" && url === DRAFT_URL)).toHaveLength(1);
  });

  it("lists publish-check problems as jump links, blocks Publish while they stand, and focuses the item a link names", async () => {
    renderEditor({ validation: { valid: false, items: [{ itemId: "itm_per_day", code: "predicate/unsatisfiable" }] } });
    await itemList();

    const panel = screen.getByRole("region", { name: "Publish checks" });
    await within(panel).findByText("1 problem");
    expect(within(panel).getByText("predicate/unsatisfiable")).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription("Publishing is blocked until the publish checks pass.");

    await userEvent.click(within(panel).getByRole("button", { name: "Question 2" }));
    expect(rowOf("itm_per_day")).toHaveFocus();
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
    expect(alert).toHaveTextContent("Question 1 · draft/unreachable");
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
    expect(publish).toHaveAccessibleDescription("Publishing waits until the publish checks have run on the saved draft.");
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
    expect(alert).toHaveTextContent("Question 2 · predicate/unsatisfiable");
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
