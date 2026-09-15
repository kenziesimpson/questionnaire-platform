import type { QuestionnaireSummary, VersionSummary } from "@qp/shared";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app";
import { createAppRouter } from "../../src/router";
import {
  QUESTIONNAIRE_ID,
  aDraft,
  draftResponse,
  jsonResponse,
  problemResponse,
  stubFetch,
  testQueryClient,
  type FetchHandler,
} from "../fixtures";

const JSDOM_CANNOT_EVALUATE = { "color-contrast": { enabled: false } };

const DEFINITION = "/api/definition/questionnaires";

function aVersion(version: number, itemCount: number, publishedAt: string): VersionSummary {
  return { questionnaireId: QUESTIONNAIRE_ID, version, publishedAt, publishedBy: null, itemCount, formatVersion: 1 };
}

function aSummary(overrides: Partial<QuestionnaireSummary> = {}): QuestionnaireSummary {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    key: "qnr_intake",
    name: "Patient Intake",
    currentVersion: 2,
    closesAt: null,
    hasDraft: false,
    createdAt: "2026-09-12T16:00:00.000Z",
    updatedAt: "2026-09-13T09:14:00.000Z",
    ...overrides,
  };
}

const TWO_VERSIONS = [aVersion(2, 4, "2026-09-13T09:14:00.000Z"), aVersion(1, 3, "2026-09-12T16:02:00.000Z")];

function serve({
  versions = () => jsonResponse(200, TWO_VERSIONS),
  summaries = [aSummary()],
}: {
  versions?: () => Response;
  summaries?: QuestionnaireSummary[];
}): FetchHandler {
  return ({ url }) => {
    if (url === DEFINITION) return jsonResponse(200, summaries);
    if (url === `${DEFINITION}/${QUESTIONNAIRE_ID}/versions`) return versions();
    throw new Error(`unexpected request to ${url}`);
  };
}

function renderHistory(handler: FetchHandler) {
  const requests = stubFetch(handler);
  const queryClient = testQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [`/admin/questionnaires/${QUESTIONNAIRE_ID}/versions`] }),
  });
  const { container } = render(<App queryClient={queryClient} router={router} />);
  return { container, router, requests };
}

async function findRows() {
  const table = await screen.findByRole("table", { name: /published versions/i });
  const [header, ...rows] = within(table).getAllByRole("row");
  return { table, header, rows };
}

function cellsOf(row: HTMLElement) {
  return within(row).getAllByRole("cell");
}

describe("the version history screen", () => {
  it("lists the versions newest first, in the order the server returns them", async () => {
    renderHistory(serve({}));

    const { rows } = await findRows();

    expect(rows.map((row) => cellsOf(row)[0]?.textContent)).toEqual(["Version 2", "Version 1"]);
    expect(cellsOf(rows[0]!)[1]).toHaveTextContent("4 questions");
    expect(within(rows[0]!).getByRole("time")).toHaveAttribute("datetime", "2026-09-13T09:14:00.000Z");
  });

  it("renders the absent publisher as a dash, keeping the column", async () => {
    renderHistory(serve({}));

    const { header, rows } = await findRows();
    const columns = within(header).getAllByRole("columnheader").map((column) => column.textContent);
    const publishedBy = columns.indexOf("Published by");

    expect(publishedBy).toBeGreaterThan(-1);
    expect(rows.map((row) => cellsOf(row)[publishedBy]?.textContent)).toEqual(["—", "—"]);
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });

  it("has no response-count column", async () => {
    renderHistory(serve({}));

    const { header } = await findRows();

    expect(within(header).getAllByRole("columnheader").map((column) => column.textContent)).toEqual([
      "Version",
      "Contents",
      "Published",
      "Published by",
      "Actions",
    ]);
    expect(screen.queryByRole("columnheader", { name: /response/i })).not.toBeInTheDocument();
  });

  it("explains immutability in one note under the table and says nothing about response counts or reporting", async () => {
    renderHistory(serve({}));

    const { table } = await findRows();
    const note = screen.getByText(/A published version cannot be edited, only superseded\./);

    expect(note.tagName).toBe("P");
    expect(note).toHaveTextContent("Sessions started against a version stay on it to the end");
    expect(table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/response counts|reporting/i)).not.toBeInTheDocument();
  });

  it("links each version to its own preview", async () => {
    const { router } = renderHistory(serve({}));

    const version1 = await screen.findByRole("link", { name: "Preview version 1" });

    expect(screen.getByRole("link", { name: "Preview version 2" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${QUESTIONNAIRE_ID}/versions/2`,
    );
    expect(version1).toHaveAttribute("href", `/admin/questionnaires/${QUESTIONNAIRE_ID}/versions/1`);

    await userEvent.click(version1);

    expect(await screen.findByRole("heading", { level: 1, name: "Preview of version 1" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/questionnaires/${QUESTIONNAIRE_ID}/versions/1`);
  });

  it("shows the open draft above the versions, with its edited time and a link to the draft editor", async () => {
    renderHistory(serve({ summaries: [aSummary({ hasDraft: true, updatedAt: "2026-09-14T08:30:00.000Z" })] }));

    const { rows } = await findRows();
    const [draft] = rows;

    expect(rows).toHaveLength(3);
    expect(cellsOf(draft!)[0]).toHaveTextContent("Draft");
    expect(within(draft!).getByRole("time")).toHaveAttribute("datetime", "2026-09-14T08:30:00.000Z");
    expect(within(draft!).getByRole("link", { name: "Edit the draft" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${QUESTIONNAIRE_ID}/draft`,
    );
  });

  it("shows no draft row when the questionnaire has no draft", async () => {
    renderHistory(serve({}));

    const { rows } = await findRows();

    expect(rows).toHaveLength(2);
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit the draft" })).not.toBeInTheDocument();
  });

  it("puts a back link to the questionnaires beside the title and names the questionnaire under it", async () => {
    const { router } = renderHistory(serve({}));

    await findRows();
    const heading = screen.getByRole("heading", { level: 1, name: "Version history" });
    const back = screen.getByRole("link", { name: "Back to questionnaires" });

    expect(back).toHaveAttribute("href", "/admin/questionnaires");
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Patient Intake")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();

    await userEvent.click(back);

    expect(router.state.location.pathname).toBe("/questionnaires");
  });

  it("offers Open the next draft beside the title when a published questionnaire has no draft, and opens it", async () => {
    const draftUrl = `${DEFINITION}/${QUESTIONNAIRE_ID}/draft`;
    const opened = aDraft();
    const { router, requests } = renderHistory((request) => {
      if (request.method === "POST" && request.url === draftUrl) return draftResponse(opened, 1, 201);
      if (request.url === `${DEFINITION}/${QUESTIONNAIRE_ID}/draft/validate`) return jsonResponse(200, { valid: true, items: [] });
      if (request.url.startsWith("/api/definition/questions")) return jsonResponse(200, []);
      return serve({})(request);
    });

    await findRows();
    await userEvent.click(screen.getByRole("button", { name: "Open the next draft" }));

    expect(await screen.findByRole("heading", { level: 1, name: opened.title })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/questionnaires/${QUESTIONNAIRE_ID}/draft`);
    expect(requests.filter(({ method, url }) => method === "POST" && url === draftUrl)).toHaveLength(1);
  });

  it("on 409 questionnaire/draft-exists from Open the next draft goes to the draft that exists, with no error", async () => {
    const draftUrl = `${DEFINITION}/${QUESTIONNAIRE_ID}/draft`;
    const theirs = aDraft(["itm_09"]);
    const { router } = renderHistory((request) => {
      if (request.url === draftUrl) {
        return request.method === "POST" ? problemResponse("questionnaire/draft-exists") : draftResponse(theirs, 4);
      }
      if (request.url === `${DEFINITION}/${QUESTIONNAIRE_ID}/draft/validate`) return jsonResponse(200, { valid: true, items: [] });
      if (request.url.startsWith("/api/definition/questions")) return jsonResponse(200, []);
      return serve({})(request);
    });

    await findRows();
    await userEvent.click(screen.getByRole("button", { name: "Open the next draft" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/questionnaires/${QUESTIONNAIRE_ID}/draft`));
    expect(screen.queryByText("The draft could not be opened. Try again.")).not.toBeInTheDocument();
  });

  it("says so when Open the next draft fails, and stays on the history", async () => {
    const { router } = renderHistory((request) =>
      request.method === "POST" ? problemResponse("internal", { detail: "trace-4" }) : serve({})(request),
    );

    await findRows();
    await userEvent.click(screen.getByRole("button", { name: "Open the next draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The draft could not be opened. Try again.");
    expect(router.state.location.pathname).toBe(`/questionnaires/${QUESTIONNAIRE_ID}/versions`);
  });

  it.each([
    ["a draft is already open", aSummary({ hasDraft: true })],
    ["nothing has been published", aSummary({ currentVersion: null, hasDraft: true })],
  ])("offers no Open the next draft when %s", async (_, summary) => {
    renderHistory(serve({ summaries: [summary], versions: () => jsonResponse(200, summary.currentVersion === null ? [] : TWO_VERSIONS) }));

    await findRows();

    expect(screen.queryByRole("button", { name: "Open the next draft" })).not.toBeInTheDocument();
  });

  it("says a questionnaire with no published version was never published, beside its draft", async () => {
    renderHistory(
      serve({
        versions: () => jsonResponse(200, []),
        summaries: [aSummary({ currentVersion: null, hasDraft: true })],
      }),
    );

    const { rows } = await findRows();

    expect(rows).toHaveLength(2);
    expect(cellsOf(rows[0]!)[0]).toHaveTextContent("Draft");
    expect(rows[1]).toHaveTextContent("Never published");
    expect(screen.queryByRole("link", { name: /^Preview/ })).not.toBeInTheDocument();
  });

  it("shows a loading state until the versions arrive", async () => {
    let answer: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((settle) => {
      answer = settle;
    });
    renderHistory(({ url }) => (url === DEFINITION ? jsonResponse(200, [aSummary()]) : pending));

    expect(await screen.findByRole("status")).toHaveTextContent("Loading versions");

    answer(jsonResponse(200, TWO_VERSIONS));

    await findRows();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tells the author a questionnaire that does not exist was not found, with a way back", async () => {
    renderHistory(
      serve({ versions: () => problemResponse("resource/not-found", { detail: "No such questionnaire" }), summaries: [] }),
    );

    expect(await screen.findByText("This questionnaire does not exist.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const backLinks = screen.getAllByRole("link", { name: "Back to questionnaires" });
    expect(backLinks).toHaveLength(2);
    expect(backLinks.map((link) => link.getAttribute("href"))).toEqual(["/admin/questionnaires", "/admin/questionnaires"]);
    expect(screen.getByRole("heading", { level: 1, name: "Version history" })).toBeInTheDocument();
  });

  it("reports a failed load and retries it on request", async () => {
    let failures = 1;
    const { requests } = renderHistory(
      serve({
        versions: () => (failures-- > 0 ? problemResponse("internal", { detail: "boom" }) : jsonResponse(200, TWO_VERSIONS)),
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("The version history could not be loaded.");
    expect(screen.queryByText("This questionnaire does not exist.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    const { rows } = await findRows();
    expect(rows).toHaveLength(2);
    expect(requests.filter(({ url }) => url.endsWith("/versions"))).toHaveLength(2);
  });

  it.each([
    ["the versions and a draft", serve({ summaries: [aSummary({ hasDraft: true })] }), () => findRows()],
    ["the versions and Open the next draft", serve({}), () => screen.findByRole("button", { name: "Open the next draft" })],
    [
      "never published",
      serve({ versions: () => jsonResponse(200, []), summaries: [aSummary({ currentVersion: null, hasDraft: true })] }),
      () => findRows(),
    ],
    [
      "not found",
      serve({ versions: () => problemResponse("resource/not-found"), summaries: [] }),
      () => screen.findByText("This questionnaire does not exist."),
    ],
    [
      "a failed load",
      serve({ versions: () => problemResponse("internal", { detail: "boom" }) }),
      () => screen.findByRole("alert"),
    ],
  ])("has no axe violations showing %s", async (_state, handler, settled) => {
    const { container } = renderHistory(handler);
    await settled();

    const results = await axe.run(container, { rules: JSDOM_CANNOT_EVALUATE });

    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  });
});
