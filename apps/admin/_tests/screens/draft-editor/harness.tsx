import type { DraftItem, Question, QuestionVersion, QuestionnaireDraft, QuestionnaireSummary } from "@qp/shared";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { App } from "../../../src/app";
import { createAppRouter } from "../../../src/router";
import {
  QUESTIONNAIRE_ID,
  VERSION_ID,
  draftResponse,
  jsonResponse,
  problemResponse,
  stubFetch,
  testQueryClient,
  type RecordedRequest,
} from "../../fixtures";
import { aBankQuestion, aQuestionVersion } from "../question-editor/harness";

export const DEFINITION = "/api/definition";
export const DRAFT_URL = `${DEFINITION}/questionnaires/${QUESTIONNAIRE_ID}/draft`;
export const VALIDATE_URL = `${DRAFT_URL}/validate`;
export const PUBLISH_URL = `${DEFINITION}/questionnaires/${QUESTIONNAIRE_ID}/publish`;
export const LIST_URL = `${DEFINITION}/questionnaires`;
export const BANK_URL = `${DEFINITION}/questions?includeArchived=true`;
export const ACTIVE_BANK_URL = `${DEFINITION}/questions?includeArchived=false`;

export const uuid = (n: number) => `01a0950e-56a0-73d6-b936-4a1e10eff${String(n).padStart(3, "0")}`;

export const smoke = aQuestionVersion({
  type: "single_choice",
  questionId: uuid(101),
  questionVersion: 1,
  prompt: "Do you smoke?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
});
export const perDay = aQuestionVersion({
  type: "number",
  questionId: uuid(102),
  questionVersion: 2,
  prompt: "How many a day?",
  unit: "cigarettes",
});
export const started = aQuestionVersion({ type: "date", questionId: uuid(103), questionVersion: 1, prompt: "When did you start?" });
export const notes = aQuestionVersion({ type: "text", questionId: uuid(104), questionVersion: 1, prompt: "Anything else?" });
export const alcohol = aQuestionVersion({ type: "number", questionId: uuid(105), questionVersion: 4, prompt: "Units of alcohol a week?" });

export const isYes = { type: "single_choice", itemId: "itm_smoke", op: "is", optionId: "yes" } as const;

export function placed(itemId: string, question: QuestionVersion, visibleWhen: DraftItem["visibleWhen"] = null): DraftItem {
  return { itemId, required: true, visibleWhen, questionId: question.questionId, questionVersion: question.questionVersion };
}

export const pool = [smoke, perDay, started, notes, alcohol];

export function aDraftOf(items: DraftItem[]): QuestionnaireDraft {
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

export const standardDraft = aDraftOf([
  placed("itm_smoke", smoke),
  placed("itm_per_day", perDay, { all: [isYes] }),
  placed("itm_started", started),
  placed("itm_notes", notes),
]);

export const summary: QuestionnaireSummary = {
  questionnaireId: QUESTIONNAIRE_ID,
  key: null,
  name: "Smoking history",
  currentVersion: 2,
  closesAt: null,
  hasDraft: true,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-14T09:00:00.000Z",
};

export type Handler = (request: RecordedRequest) => Response | Promise<Response>;

export interface Validation {
  valid: boolean;
  items: { itemId: string; code: string }[];
}

interface Setup {
  draft?: QuestionnaireDraft;
  bank?: Question[];
  validation?: Validation;
  overrides?: Record<string, Handler>;
}

function echoSaved(revision: { current: number }): Handler {
  return ({ body }) => {
    revision.current += 1;
    const items: DraftItem[] = body !== null && typeof body === "object" && "items" in body && Array.isArray(body.items) ? body.items : [];
    return draftResponse(aDraftOf(items), revision.current);
  };
}

export function renderEditor({ draft = standardDraft, bank = pool.map(aBankQuestion), validation = { valid: true, items: [] }, overrides = {} }: Setup = {}) {
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

export const itemList = () => screen.findByRole("list", { name: "Questions, in the order respondents see them" });

export async function promptsInOrder() {
  const rows = within(await itemList()).getAllByRole("listitem").filter((row) => row.hasAttribute("data-item-id"));
  return rows.map((row) => row.querySelector(".font-medium")?.textContent);
}

export function puts(requests: RecordedRequest[]) {
  return requests.filter(({ method, url }) => method === "PUT" && url === DRAFT_URL);
}

export function validations(requests: RecordedRequest[]) {
  return requests.filter(({ method, url }) => method === "POST" && url === VALIDATE_URL);
}

export async function lastPutItems(requests: RecordedRequest[]): Promise<DraftItem[]> {
  await waitFor(() => expect(puts(requests).length).toBeGreaterThan(0));
  const body = puts(requests).at(-1)?.body;
  return body !== null && typeof body === "object" && "items" in body && Array.isArray(body.items) ? body.items : [];
}

export function rowOf(itemId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`li[data-item-id="${itemId}"]`);
  if (row === null) throw new Error(`no row for ${itemId}`);
  return row;
}

export function optionLabels(select: HTMLElement) {
  if (!(select instanceof HTMLSelectElement)) throw new Error("not a select");
  return Array.from(select.options).map((option) => option.textContent);
}
