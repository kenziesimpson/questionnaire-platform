import type { Question, QuestionUsage, QuestionnaireSummary } from "@qp/shared";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeAll, describe, expect, it } from "vitest";
import { App } from "../../src/app";
import { createAppRouter } from "../../src/router";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubFetch,
  testQueryClient,
  type FetchHandler,
  type RecordedRequest,
} from "../fixtures";
import { aBankQuestion, aQuestionVersion, fillJsdomLayoutGaps } from "./question-editor/harness";

beforeAll(fillJsdomLayoutGaps);

const JSDOM_CANNOT_EVALUATE = { "color-contrast": { enabled: false } };
const BANK_URL = "/api/definition/questions?includeArchived=true";
const QUESTIONNAIRES_URL = "/api/definition/questionnaires";

const INTAKE_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";
const REVIEW_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8d0";
const CONDITION_ID = "01a0950e-56a0-73d6-b936-4a1e10eff9a1";
const PHARMACY_ID = "01a0950e-56a0-73d6-b936-4a1e10eff9a2";
const SMOKER_ID = "01a0950e-56a0-73d6-b936-4a1e10eff9a3";

const usageUrl = (questionId: string) => `/api/definition/questions/${questionId}/usage`;

const condition: Question = {
  ...aBankQuestion(
    aQuestionVersion({
      type: "single_choice",
      questionId: CONDITION_ID,
      questionVersion: 4,
      prompt: "Which condition?",
      createdAt: "2025-09-13T09:00:00.000Z",
    }),
  ),
  key: "qst_which_condition",
};
const pharmacy: Question = aBankQuestion(
  aQuestionVersion({
    type: "text",
    questionId: PHARMACY_ID,
    questionVersion: 2,
    prompt: "Preferred pharmacy",
    createdAt: "2025-09-14T09:00:00.000Z",
  }),
);
const smoker: Question = {
  ...aBankQuestion(
    aQuestionVersion({
      type: "single_choice",
      questionId: SMOKER_ID,
      questionVersion: 2,
      prompt: "Do you smoke?",
      createdAt: "2025-09-04T09:00:00.000Z",
    }),
  ),
  archivedAt: "2025-09-05T09:00:00.000Z",
};

function aSummary(questionnaireId: string, name: string): QuestionnaireSummary {
  return {
    questionnaireId,
    key: null,
    name,
    currentVersion: 2,
    closesAt: null,
    hasDraft: false,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-02T09:00:00.000Z",
  };
}

const conditionUsage: QuestionUsage[] = [
  { questionnaireId: INTAKE_ID, version: 2, questionVersion: 4 },
  { questionnaireId: INTAKE_ID, version: 1, questionVersion: 3 },
  { questionnaireId: REVIEW_ID, version: 1, questionVersion: 4 },
];

type Routes = Record<string, (request: RecordedRequest) => Response | Promise<Response>>;

function routed(routes: Routes): FetchHandler {
  return (request) => {
    const respond = routes[`${request.method} ${request.url}`];
    return respond ? respond(request) : jsonResponse(200, []);
  };
}

function bankRoutes(overrides: Routes = {}): Routes {
  return {
    [`GET ${BANK_URL}`]: () => jsonResponse(200, [smoker, condition, pharmacy]),
    [`GET ${QUESTIONNAIRES_URL}`]: () =>
      jsonResponse(200, [aSummary(INTAKE_ID, "Patient Intake"), aSummary(REVIEW_ID, "Medication Review")]),
    [`GET ${usageUrl(CONDITION_ID)}`]: () => jsonResponse(200, conditionUsage),
    ...overrides,
  };
}

function renderBank(routes: Routes = bankRoutes()) {
  const requests = stubFetch(routed(routes));
  const queryClient = testQueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: ["/admin/questions"] }) });
  const { container } = render(<App queryClient={queryClient} router={router} />);
  return { requests, router, container };
}

function callsTo(requests: RecordedRequest[], method: string, url: string) {
  return requests.filter((request) => request.method === method && request.url === url);
}

function rowOf(prompt: string): HTMLElement {
  const row = within(screen.getByRole("table", { hidden: true })).getByText(prompt, { selector: "span" }).closest("tr");
  if (row === null) throw new Error(`no row for ${prompt}`);
  return row;
}

function promptsInOrder(): string[] {
  const [, ...bodyRows] = within(screen.getByRole("table")).getAllByRole("row");
  return bodyRows.map((row) => row.querySelector("td span span")?.textContent ?? "");
}

async function violationsIn(element: Element) {
  const results = await axe.run(element, { rules: JSDOM_CANNOT_EVALUATE });
  return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}

const focused = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);

describe("the question bank list", () => {
  it("asks for archived questions too and sorts rows by the latest version's createdAt, newest first, with no search or filter", async () => {
    const { requests } = renderBank();

    await screen.findByRole("table");

    expect(callsTo(requests, "GET", BANK_URL)).toHaveLength(1);
    expect(promptsInOrder()).toEqual(["Preferred pharmacy", "Which condition?", "Do you smoke?"]);
    expect(screen.getByText("3 questions, 1 archived · most recently changed first")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Last changed" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows each question's prompt, type, key when it has one, latest version and when that version was saved", async () => {
    renderBank();

    await screen.findByRole("table");

    const conditionRow = within(rowOf("Which condition?"));
    expect(conditionRow.getByText("Single choice")).toBeInTheDocument();
    expect(conditionRow.getByText("qst_which_condition")).toBeInTheDocument();
    expect(conditionRow.getByText("v4")).toBeInTheDocument();
    expect(conditionRow.getByText(/^13 Sept? 2025$/, { selector: "time" })).toHaveAttribute(
      "datetime",
      "2025-09-13T09:00:00.000Z",
    );
    const pharmacyRow = within(rowOf("Preferred pharmacy"));
    expect(pharmacyRow.getByText("Text")).toBeInTheDocument();
    expect(pharmacyRow.getByText("v2")).toBeInTheDocument();
    expect(pharmacyRow.queryByText(/^qst_/)).not.toBeInTheDocument();
  });

  it("marks an archived question and offers it no edit or archive action", async () => {
    renderBank();

    await screen.findByRole("table");

    const smokerRow = within(rowOf("Do you smoke?"));
    expect(smokerRow.getByText("Archived")).toBeInTheDocument();
    expect(smokerRow.queryByRole("button")).not.toBeInTheDocument();
    expect(within(rowOf("Which condition?")).queryByText("Archived")).not.toBeInTheDocument();
    expect(within(rowOf("Which condition?")).getByRole("button", { name: "Edit Which condition?" })).toBeInTheDocument();
  });

  it("shows a loading status while the bank is pending", async () => {
    const pending = deferred<Response>();
    renderBank(bankRoutes({ [`GET ${BANK_URL}`]: () => pending.promise }));

    expect(await screen.findByRole("status")).toHaveTextContent("Loading questions…");

    pending.resolve(jsonResponse(200, [pharmacy]));

    await screen.findByRole("table");
    expect(screen.queryByText("Loading questions…")).not.toBeInTheDocument();
  });

  it("shows the empty state for an empty bank", async () => {
    renderBank(bankRoutes({ [`GET ${BANK_URL}`]: () => jsonResponse(200, []) }));

    expect(await screen.findByText("No questions yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an alert when the bank fails to load, and Try again loads it", async () => {
    const responses = [problemResponse("internal", { detail: "req-1" }), jsonResponse(200, [pharmacy])];
    renderBank(bankRoutes({ [`GET ${BANK_URL}`]: () => responses.shift() ?? jsonResponse(200, []) }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The question bank could not be loaded.");

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("the question bank's usage column", () => {
  it("lists the published versions using a question, grouped under each questionnaire's name, each linking to its preview", async () => {
    renderBank();

    const usage = await screen.findByRole("list", { name: "Published versions using Which condition?" });

    const lines = within(usage).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual(["Patient Intakev1,v2", "Medication Reviewv1"]);
    expect(within(lines[0] ?? usage).getByText("Patient Intake")).toHaveAttribute("title", "Patient Intake");
    expect(within(usage).getByRole("link", { name: "Preview Patient Intake v2, which uses question v4" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${INTAKE_ID}/versions/2`,
    );
    expect(within(usage).getByRole("link", { name: "Preview Medication Review v1, which uses question v4" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${REVIEW_ID}/versions/1`,
    );
  });

  it("says a question in no published version is not used", async () => {
    renderBank();

    await screen.findByRole("table");

    expect(await within(rowOf("Preferred pharmacy")).findByText("Not in any published version")).toBeInTheDocument();
  });

  it("reports a failed usage read in its own row, and Retry loads it", async () => {
    const responses = [problemResponse("internal", { detail: "req-2" }), jsonResponse(200, conditionUsage)];
    renderBank(bankRoutes({ [`GET ${usageUrl(CONDITION_ID)}`]: () => responses.shift() ?? jsonResponse(200, []) }));

    await screen.findByRole("table");
    const retry = await within(rowOf("Which condition?")).findByRole("button", {
      name: "Retry loading usage of Which condition?",
    });
    expect(within(rowOf("Preferred pharmacy")).queryByText("Usage not loaded")).not.toBeInTheDocument();

    await userEvent.click(retry);

    expect(await screen.findByRole("list", { name: "Published versions using Which condition?" })).toBeInTheDocument();
  });
});

describe("archiving from the question bank", () => {
  it("asks for confirmation, posts the archive, and marks the row archived from the response without refetching the bank", async () => {
    const archived: Question = { ...pharmacy, archivedAt: "2026-09-14T10:00:00.000Z" };
    const { requests } = renderBank(
      bankRoutes({ [`POST /api/definition/questions/${PHARMACY_ID}/archive`]: () => jsonResponse(200, archived) }),
    );
    await screen.findByRole("table");

    await userEvent.click(within(rowOf("Preferred pharmacy")).getByRole("button", { name: "Archive Preferred pharmacy" }));

    const dialog = screen.getByRole("dialog", { name: "Archive this question?" });
    expect(dialog).toHaveTextContent("Preferred pharmacy stays in the bank, marked archived");
    expect(callsTo(requests, "POST", `/api/definition/questions/${PHARMACY_ID}/archive`)).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole("button", { name: "Archive question" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowOf("Preferred pharmacy")).getByText("Archived")).toBeInTheDocument();
    expect(within(rowOf("Preferred pharmacy")).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 questions, 2 archived · most recently changed first")).toBeInTheDocument();
    expect(callsTo(requests, "POST", `/api/definition/questions/${PHARMACY_ID}/archive`)).toHaveLength(1);
    expect(callsTo(requests, "GET", BANK_URL)).toHaveLength(1);
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    const { requests } = renderBank();
    await screen.findByRole("table");

    await userEvent.click(within(rowOf("Preferred pharmacy")).getByRole("button", { name: "Archive Preferred pharmacy" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requests.filter((request) => request.method === "POST")).toEqual([]);
  });

  it("keeps the dialog open with an alert when the archive fails, and archives on a second try", async () => {
    const archived: Question = { ...pharmacy, archivedAt: "2026-09-14T10:00:00.000Z" };
    const responses = [problemResponse("internal", { detail: "req-3" }), jsonResponse(200, archived)];
    renderBank(
      bankRoutes({
        [`POST /api/definition/questions/${PHARMACY_ID}/archive`]: () => responses.shift() ?? jsonResponse(200, archived),
      }),
    );
    await screen.findByRole("table");

    await userEvent.click(within(rowOf("Preferred pharmacy")).getByRole("button", { name: "Archive Preferred pharmacy" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive question" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The question was not archived.");
    expect(within(rowOf("Preferred pharmacy")).queryByText("Archived")).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Archive question" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowOf("Preferred pharmacy")).getByText("Archived")).toBeInTheDocument();
  });

  it("on 404 says the question no longer exists and refetches the bank", async () => {
    const lists = [[smoker, condition, pharmacy], [smoker, condition]];
    const { requests } = renderBank(
      bankRoutes({
        [`GET ${BANK_URL}`]: () => jsonResponse(200, lists.shift() ?? []),
        [`POST /api/definition/questions/${PHARMACY_ID}/archive`]: () => problemResponse("resource/not-found"),
      }),
    );
    await screen.findByRole("table");

    await userEvent.click(within(rowOf("Preferred pharmacy")).getByRole("button", { name: "Archive Preferred pharmacy" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive question" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This question no longer exists");
    await waitFor(() => expect(callsTo(requests, "GET", BANK_URL)).toHaveLength(2));
  });
});

describe("creating and editing from the question bank", () => {
  it("opens the question editor from New question with focus inside, keeps Tab inside it, and gives focus back on Escape", async () => {
    renderBank();
    const opener = await screen.findByRole("button", { name: "New question" });

    await userEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "New question" });
    await waitFor(() => expect(dialog).toContainElement(focused()));
    for (let step = 0; step < 25; step += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(focused());
    }
    for (let step = 0; step < 25; step += 1) {
      await userEvent.tab({ shift: true });
      expect(dialog).toContainElement(focused());
    }

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes the new question dialog from Cancel without writing anything", async () => {
    const { requests } = renderBank();
    const opener = await screen.findByRole("button", { name: "New question" });

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(requests.filter((request) => request.method === "POST")).toEqual([]);
  });

  it("creates a question through POST /questions and refetches the bank", async () => {
    const created = aBankQuestion(
      aQuestionVersion({ type: "text", questionId: SMOKER_ID, questionVersion: 1, prompt: "Any allergies?" }),
    );
    const lists = [[condition], [created, condition]];
    const { requests } = renderBank(
      bankRoutes({
        [`GET ${BANK_URL}`]: () => jsonResponse(200, lists.shift() ?? []),
        [`POST /api/definition/questions`]: () => jsonResponse(201, created),
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "New question" }));
    const dialog = screen.getByRole("dialog", { name: "New question" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Text" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Prompt" }), "Any allergies?");

    await userEvent.click(within(dialog).getByRole("button", { name: "Save as version 1" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Any allergies?", { selector: "span" })).toBeInTheDocument();
    expect(callsTo(requests, "POST", "/api/definition/questions")).toHaveLength(1);
    expect(callsTo(requests, "GET", BANK_URL)).toHaveLength(2);
  });

  it("edits a row's latest version through POST /questions/:id/versions, and the refetched row shows the new version", async () => {
    const saved = aQuestionVersion({
      type: "text",
      questionId: PHARMACY_ID,
      questionVersion: 3,
      prompt: "Preferred pharmacy or chemist",
      createdAt: "2026-09-14T11:00:00.000Z",
    });
    const lists = [[condition, pharmacy], [condition, aBankQuestion(saved)]];
    const { requests } = renderBank(
      bankRoutes({
        [`GET ${BANK_URL}`]: () => jsonResponse(200, lists.shift() ?? []),
        [`POST /api/definition/questions/${PHARMACY_ID}/versions`]: () => jsonResponse(201, saved),
      }),
    );
    await screen.findByRole("table");

    await userEvent.click(within(rowOf("Preferred pharmacy")).getByRole("button", { name: "Edit Preferred pharmacy" }));

    const dialog = screen.getByRole("dialog", { name: "Edit question" });
    expect(dialog).toHaveTextContent("version 2");
    const prompt = within(dialog).getByRole("textbox", { name: "Prompt" });
    expect(prompt).toHaveValue("Preferred pharmacy");
    await userEvent.type(prompt, " or chemist");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save as version 3" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const row = within(rowOf("Preferred pharmacy or chemist"));
    expect(await row.findByText("v3")).toBeInTheDocument();
    const [body] = callsTo(requests, "POST", `/api/definition/questions/${PHARMACY_ID}/versions`).map((request) => request.body);
    expect(body).toMatchObject({ question: { type: "text", prompt: "Preferred pharmacy or chemist" } });
  });
});

describe("question bank accessibility", () => {
  it("has no axe violations in the populated list with usage loaded", async () => {
    const { container } = renderBank();
    await screen.findByRole("list", { name: "Published versions using Which condition?" });

    expect(await violationsIn(container)).toEqual([]);
  });

  it("has no axe violations in the archive confirmation", async () => {
    renderBank();
    await screen.findByRole("table");

    await userEvent.click(within(rowOf("Preferred pharmacy")).getByRole("button", { name: "Archive Preferred pharmacy" }));

    expect(await violationsIn(screen.getByRole("dialog"))).toEqual([]);
  });

  it.each([
    ["the empty state", () => jsonResponse(200, []), "No questions yet"],
    ["a failed load", () => problemResponse("internal", { detail: "req-4" }), "The question bank could not be loaded."],
  ])("has no axe violations in %s", async (_, respond, text) => {
    const { container } = renderBank(bankRoutes({ [`GET ${BANK_URL}`]: respond }));
    await screen.findByText(text);

    expect(await violationsIn(container)).toEqual([]);
  });
});
