import { reportingApi, type QuestionnaireSummary, type SessionSummaryPage, type VersionSummary } from "@qp/shared";
import { axeViolations, contractResponse, jsonResponse, problemResponse, stubFetch, type RecordedRequest, type Reply } from "@qp/ui/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { renderAppAt } from "../support/render-app";
import {
  aSessionPage,
  aSessionSummary,
  anInProgressSummary,
  sessionIdOf,
  shortIdOf,
  startedAtOf,
} from "../support/reporting";
import { LIST_URL, VERSIONS_URL } from "../support/routes";

const RESPONSES_PATH = `/questionnaires/${QUESTIONNAIRE_ID}/responses`;

const SUMMARY: QuestionnaireSummary = {
  questionnaireId: QUESTIONNAIRE_ID,
  key: "qnr_intake",
  name: "Patient Intake",
  currentVersion: 2,
  closesAt: null,
  hasDraft: false,
  createdAt: "2026-09-12T16:00:00.000Z",
  updatedAt: "2026-09-13T09:14:00.000Z",
};

function aVersion(version: number): VersionSummary {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    version,
    publishedAt: "2026-09-13T09:14:00.000Z",
    publishedBy: null,
    itemCount: 4,
    formatVersion: 1,
  };
}

const TWO_VERSIONS = [aVersion(2), aVersion(1)];

const FIRST_PAGE = aSessionPage([aSessionSummary(3, { version: 2 }), anInProgressSummary(2, { version: 2 }), aSessionSummary(1)], {
  older: "cursor-older",
});
const SECOND_PAGE = aSessionPage([aSessionSummary(0)], { newer: "cursor-newer" });

interface Serving {
  pages?: Record<string, SessionSummaryPage>;
  sessions?: () => Response;
  versions?: () => Response;
  summaries?: QuestionnaireSummary[];
}

function serve({
  pages = { "": FIRST_PAGE },
  sessions,
  versions = () => jsonResponse(200, TWO_VERSIONS),
  summaries = [SUMMARY],
}: Serving = {}): Reply {
  return ({ url }) => {
    if (url === LIST_URL) return jsonResponse(200, summaries);
    if (url === VERSIONS_URL) return versions();
    if (url.startsWith(`${reportingApi.REPORTING_PREFIX}/`)) {
      if (sessions !== undefined) return sessions();
      const cursor = new URL(url, "http://localhost").searchParams.get("cursor") ?? "";
      const page = pages[cursor];
      if (page === undefined) throw new Error(`no page served for cursor "${cursor}"`);
      return contractResponse(reportingApi.listSessions, 200, page);
    }
    throw new Error(`unexpected request to ${url}`);
  };
}

function renderList(handler: Reply, search = "") {
  const requests = stubFetch(handler);
  return { requests, ...renderAppAt(`${RESPONSES_PATH}${search}`) };
}

function sessionQueries(requests: RecordedRequest[]): Record<string, string>[] {
  return requests
    .filter(({ url }) => url.startsWith(`${reportingApi.REPORTING_PREFIX}/`))
    .map(({ url }) => Object.fromEntries(new URL(url, "http://localhost").searchParams));
}

async function findRows() {
  const table = await screen.findByRole("table", { name: /^Sessions, newest started first/ });
  const [header, ...rows] = within(table).getAllByRole("row");
  if (header === undefined) throw new Error("expected a header row");
  return { table, header, rows };
}

function cellTexts(row: HTMLElement): (string | null)[] {
  return within(row).getAllByRole("cell").map((cell) => cell.textContent);
}

function rowFor(rows: HTMLElement[], n: number): HTMLElement {
  const row = rows.find((candidate) => within(candidate).queryByText(shortIdOf(n)) !== null);
  if (row === undefined) throw new Error(`no row for session ${shortIdOf(n)}`);
  return row;
}

function versionSelect() {
  return screen.getByRole("combobox", { name: "Version" });
}

function statusSelect() {
  return screen.getByRole("combobox", { name: "Status" });
}

const olderButton = () => screen.getByRole("button", { name: "Older" });
const newerButton = () => screen.getByRole("button", { name: "Newer" });

describe("the responses list screen", () => {
  it("renders one row per session with the 8-character id, version, status, times and answered summary", async () => {
    renderList(serve());

    const { rows } = await findRows();

    expect(rows).toHaveLength(3);
    const submitted = rowFor(rows, 3);
    const [id, version, status, , , answered] = cellTexts(submitted);
    expect([id, version, status, answered]).toEqual([shortIdOf(3), "v2", "Submitted", "2 of 4 · 2 hidden by rules"]);
    const times = within(submitted).getAllByRole("time");
    expect(times.map((time) => time.getAttribute("datetime"))).toEqual([startedAtOf(3), startedAtOf(4)]);
    expect(within(submitted).getByText(shortIdOf(3))).toHaveAttribute("title", sessionIdOf(3));
    expect(screen.queryByText(sessionIdOf(3))).not.toBeInTheDocument();
  });

  it("shows an in-progress session with a dash for its submit time and no stored answers", async () => {
    renderList(serve());

    const { rows } = await findRows();
    const inProgress = rowFor(rows, 2);

    expect(cellTexts(inProgress).slice(1)).toEqual(["v2", "In progress", expect.stringMatching(/^10 Sept? 2026/), "—", "Not stored until submit", "Open"]);
    expect(within(inProgress).getAllByRole("time")).toHaveLength(1);
    expect(within(inProgress).getByText("In progress")).toHaveClass("border-dashed");
    expect(within(rowFor(rows, 3)).getByText("Submitted")).not.toHaveClass("border-dashed");
  });

  it("omits the hidden clause when no item was hidden", async () => {
    renderList(serve({ pages: { "": aSessionPage([aSessionSummary(5, { itemCount: 3, answeredCount: 3, hiddenCount: 0 })]) } }));

    const { rows } = await findRows();

    expect(cellTexts(rowFor(rows, 5))[5]).toBe("3 of 3");
  });

  it("opens a session from its row, keeping the filters in the link", async () => {
    const { router } = renderList(serve({ pages: { "": FIRST_PAGE } }), "?status=submitted&version=1");

    const open = await screen.findByRole("link", { name: `Open session ${shortIdOf(3)}` });
    const href = new URL(open.getAttribute("href") ?? "", "http://localhost");

    expect(href.pathname).toBe(`/admin${RESPONSES_PATH}/${sessionIdOf(3)}`);
    expect(href.searchParams.get("status")).toBe("submitted");
    expect(href.searchParams.get("version")).toBe("1");
    expect(href.searchParams.has("cursor")).toBe(false);
    expect(router.state.location.pathname).toBe(RESPONSES_PATH);
  });

  it("names the questionnaire and says the rows are raw, not aggregated, with a way to the version history", async () => {
    renderList(serve());

    await findRows();

    expect(screen.getByRole("heading", { level: 1, name: "Responses" })).toBeInTheDocument();
    expect(await screen.findByText("Patient Intake · one row per session, newest started first")).toBeInTheDocument();
    expect(screen.getByText("Raw · not aggregated")).toBeInTheDocument();
    expect(screen.getByText(/not a report: no totals, percentages, or charts/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Version history" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${QUESTIONNAIRE_ID}/versions`,
    );
    expect(screen.getByRole("link", { name: "Back to questionnaires" })).toHaveAttribute("href", "/admin/questionnaires");
  });

  describe("sorting", () => {
    it("marks Started as the descending sort and leaves the other columns unsorted", async () => {
      renderList(serve());

      const { header } = await findRows();

      expect(within(header).getByRole("columnheader", { name: "Started" })).toHaveAttribute("aria-sort", "descending");
      for (const name of ["Session", "Version", "Status", "Submitted", "Answered"]) {
        expect(within(header).getByRole("columnheader", { name })).not.toHaveAttribute("aria-sort");
      }
    });

    it("offers no control to re-sort: the order is the server's, newest started first", async () => {
      renderList(serve());

      const { header } = await findRows();

      expect(within(header).queryByRole("button")).not.toBeInTheDocument();
      expect(within(header).queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("filters", () => {
    it("lists all versions and both statuses, defaulting to all of each", async () => {
      const { requests } = renderList(serve());

      await findRows();

      await waitFor(() =>
        expect(within(versionSelect()).getAllByRole("option").map((option) => option.textContent)).toEqual([
          "All versions",
          "Version 2",
          "Version 1",
        ]),
      );
      expect(within(statusSelect()).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "All statuses",
        "Submitted",
        "In progress",
      ]);
      expect(versionSelect()).toHaveValue("");
      expect(statusSelect()).toHaveValue("");
      expect(sessionQueries(requests)).toEqual([{}]);
    });

    it("requests only that version, and puts it in the URL, when a version is chosen", async () => {
      const { router, requests } = renderList(serve({ pages: { "": FIRST_PAGE } }));
      await findRows();
      await screen.findByRole("option", { name: "Version 1" });

      await userEvent.selectOptions(versionSelect(), "1");

      await waitFor(() => expect(sessionQueries(requests)).toEqual([{}, { version: "1" }]));
      expect(router.state.location.search).toEqual({ version: 1 });
      expect(versionSelect()).toHaveValue("1");
    });

    it("requests only that status, and puts it in the URL, when a status is chosen", async () => {
      const { router, requests } = renderList(serve());
      await findRows();

      await userEvent.selectOptions(statusSelect(), "in_progress");

      await waitFor(() => expect(sessionQueries(requests)).toEqual([{}, { status: "in_progress" }]));
      expect(router.state.location.search).toEqual({ status: "in_progress" });
    });

    it("combines the two and takes either back off with All", async () => {
      const { router, requests } = renderList(serve());
      await findRows();
      await screen.findByRole("option", { name: "Version 2" });

      await userEvent.selectOptions(versionSelect(), "2");
      await userEvent.selectOptions(statusSelect(), "submitted");
      await waitFor(() => expect(router.state.location.search).toEqual({ version: 2, status: "submitted" }));
      await userEvent.selectOptions(versionSelect(), "");

      await waitFor(() => expect(router.state.location.search).toEqual({ status: "submitted" }));
      expect(sessionQueries(requests).at(-1)).toEqual({ status: "submitted" });
    });

    it("starts from the filters in the URL, and requests them", async () => {
      const { requests } = renderList(serve(), "?version=1&status=in_progress");

      await findRows();

      expect(sessionQueries(requests)).toEqual([{ version: "1", status: "in_progress" }]);
      await screen.findByRole("option", { name: "Version 1" });
      expect(versionSelect()).toHaveValue("1");
      expect(statusSelect()).toHaveValue("in_progress");
    });

    it.each([["?version=abc"], ["?version=0"], ["?version=1.5"], ["?status=bogus"], ["?cursor="]])(
      "ignores an invalid search of %s and asks for the unfiltered first page",
      async (search) => {
        const { requests } = renderList(serve(), search);

        await findRows();

        expect(sessionQueries(requests)).toEqual([{}]);
        expect(versionSelect()).toHaveValue("");
        expect(statusSelect()).toHaveValue("");
      },
    );

    it("goes back to the first page when a filter changes on a later one", async () => {
      const { router, requests } = renderList(serve({ pages: { "": FIRST_PAGE, "cursor-older": SECOND_PAGE } }), "?cursor=cursor-older");
      await findRows();

      await userEvent.selectOptions(statusSelect(), "submitted");

      await waitFor(() => expect(router.state.location.search).toEqual({ status: "submitted" }));
      expect(sessionQueries(requests)).toEqual([{ cursor: "cursor-older" }, { status: "submitted" }]);
    });
  });

  describe("paging", () => {
    it("enables Older and disables Newer on the first page", async () => {
      renderList(serve());

      await findRows();

      expect(newerButton()).toBeDisabled();
      expect(olderButton()).toBeEnabled();
      expect(screen.getByText("3 sessions on this page")).toBeInTheDocument();
    });

    it("enables Newer and disables Older on the last page", async () => {
      renderList(serve({ pages: { "": SECOND_PAGE } }));

      await findRows();

      expect(newerButton()).toBeEnabled();
      expect(olderButton()).toBeDisabled();
    });

    it("enables both in the middle of a long result", async () => {
      renderList(serve({ pages: { "": aSessionPage([aSessionSummary(1)], { older: "o", newer: "n" }) } }));
      await findRows();

      expect(newerButton()).toBeEnabled();
      expect(olderButton()).toBeEnabled();
    });

    it("disables both when everything fits on one page", async () => {
      renderList(serve({ pages: { "": aSessionPage([aSessionSummary(1)]) } }));
      await findRows();

      expect(newerButton()).toBeDisabled();
      expect(olderButton()).toBeDisabled();
    });

    it("follows the older cursor and back again with the newer one, one page at a time", async () => {
      const { router, requests } = renderList(
        serve({ pages: { "": FIRST_PAGE, "cursor-older": SECOND_PAGE, "cursor-newer": FIRST_PAGE } }),
      );
      await findRows();

      await userEvent.click(olderButton());

      await waitFor(() => expect(screen.getByText(shortIdOf(0))).toBeInTheDocument());
      expect(router.state.location.search).toEqual({ cursor: "cursor-older" });
      expect(screen.queryByText(shortIdOf(3))).not.toBeInTheDocument();
      expect(olderButton()).toBeDisabled();

      await userEvent.click(newerButton());

      await waitFor(() => expect(screen.getByText(shortIdOf(3))).toBeInTheDocument());
      expect(router.state.location.search).toEqual({ cursor: "cursor-newer" });
      expect(sessionQueries(requests)).toEqual([{}, { cursor: "cursor-older" }, { cursor: "cursor-newer" }]);
    });

    it("keeps the filters while paging", async () => {
      const { router, requests } = renderList(
        serve({ pages: { "": FIRST_PAGE, "cursor-older": SECOND_PAGE } }),
        "?version=1&status=submitted",
      );
      await findRows();

      await userEvent.click(olderButton());

      await waitFor(() => expect(sessionQueries(requests)).toHaveLength(2));
      expect(sessionQueries(requests)[1]).toEqual({ version: "1", status: "submitted", cursor: "cursor-older" });
      expect(router.state.location.search).toEqual({ version: 1, status: "submitted", cursor: "cursor-older" });
    });
  });

  describe("the empty state", () => {
    it("says there are no sessions yet when the questionnaire has none", async () => {
      renderList(serve({ pages: { "": aSessionPage([]) } }));

      const { rows } = await findRows();

      expect(rows).toHaveLength(1);
      expect(screen.getByRole("cell", { name: "No sessions yet." })).toBeInTheDocument();
      expect(screen.getByText("0 sessions on this page")).toBeInTheDocument();
      expect(newerButton()).toBeDisabled();
      expect(olderButton()).toBeDisabled();
    });

    it("says no session matches when a filter is set", async () => {
      renderList(serve({ pages: { "": aSessionPage([]) } }), "?status=in_progress");

      await findRows();

      expect(screen.getByRole("cell", { name: "No sessions match these filters." })).toBeInTheDocument();
      expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();
    });
  });

  describe("loading and failure", () => {
    it("shows a loading state until the page arrives", async () => {
      let answer: (response: Response) => void = () => undefined;
      const pending = new Promise<Response>((settle) => {
        answer = settle;
      });
      renderList((request) => (request.url.startsWith(reportingApi.REPORTING_PREFIX) ? pending : serve()(request)));

      expect(await screen.findByRole("status")).toHaveTextContent("Loading sessions");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();

      answer(contractResponse(reportingApi.listSessions, 200, FIRST_PAGE));

      await findRows();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("tells the author a questionnaire that does not exist was not found, with a way back", async () => {
      renderList(serve({ sessions: () => problemResponse("resource/not-found"), summaries: [] }));

      expect(await screen.findByText("This questionnaire does not exist.")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Back to questionnaires" })).toHaveLength(2);
    });

    it("reports a failed load and retries it on request", async () => {
      let failures = 1;
      const { requests } = renderList(
        serve({
          sessions: () =>
            failures-- > 0 ? problemResponse("internal", { detail: "boom" }) : contractResponse(reportingApi.listSessions, 200, FIRST_PAGE),
        }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent("The sessions could not be loaded.");
      expect(screen.queryByText("This questionnaire does not exist.")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      const { rows } = await findRows();
      expect(rows).toHaveLength(3);
      expect(sessionQueries(requests)).toHaveLength(2);
    });
  });

  it("has no axe violations", async () => {
    const { container } = renderList(serve());
    await findRows();

    expect(await axeViolations(container)).toEqual([]);
  });
});
