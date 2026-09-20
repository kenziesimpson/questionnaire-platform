import { reportingApi, type QuestionnaireSummary, type SessionSummaryPage, type VersionSummary } from "@qp/shared";
import { axeViolations, contractResponse, jsonResponse, problemResponse, stubFetch, type RecordedRequest, type Reply } from "@qp/ui/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { deferred } from "../support/http";
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
  next: "cursor-next",
});
const SECOND_PAGE = aSessionPage([aSessionSummary(0)], { previous: "cursor-previous" });

interface Serving {
  pages?: Record<string, SessionSummaryPage>;
  pageFor?: (query: URLSearchParams) => SessionSummaryPage;
  sessions?: () => Response;
  versions?: () => Response;
  summaries?: QuestionnaireSummary[];
}

function serve({
  pages = { "": FIRST_PAGE },
  pageFor,
  sessions,
  versions = () => jsonResponse(200, TWO_VERSIONS),
  summaries = [SUMMARY],
}: Serving = {}): Reply {
  return ({ url }) => {
    if (url === LIST_URL) return jsonResponse(200, summaries);
    if (url === VERSIONS_URL) return versions();
    if (url.startsWith(`${reportingApi.REPORTING_PREFIX}/`)) {
      if (sessions !== undefined) return sessions();
      const query = new URL(url, "http://localhost").searchParams;
      if (pageFor !== undefined) return contractResponse(reportingApi.listSessions, 200, pageFor(query));
      const cursor = query.get("cursor") ?? "";
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
  const table = await screen.findByRole("table", { name: /^Sessions, / });
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

function isReporting(url: string): boolean {
  return url.startsWith(`${reportingApi.REPORTING_PREFIX}/`);
}

function queryOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams;
}

function holdingWhen(held: (query: URLSearchParams) => boolean, release: Promise<Response>, otherwise: Reply): Reply {
  return (request) => (isReporting(request.url) && held(queryOf(request.url)) ? release : otherwise(request));
}

function tableIsBusy(): boolean {
  return screen.getByRole("table").closest("[aria-busy='true']") !== null;
}

const nextButton = () => screen.getByRole("button", { name: "Next" });
const previousButton = () => screen.getByRole("button", { name: "Previous" });

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

  it("carries the sort and the cursor as well as the filters on the link to a session, so the session can follow the same order", async () => {
    renderList(
      serve({ pages: { "cursor-next": SECOND_PAGE } }),
      "?status=submitted&version=1&sort=submitted&order=asc&cursor=cursor-next",
    );

    const open = await screen.findByRole("link", { name: `Open session ${shortIdOf(0)}` });
    const href = new URL(open.getAttribute("href") ?? "", "http://localhost");

    expect(href.pathname).toBe(`/admin${RESPONSES_PATH}/${sessionIdOf(0)}`);
    expect(Object.fromEntries(href.searchParams)).toEqual({
      status: "submitted",
      version: "1",
      sort: "submitted",
      order: "asc",
      cursor: "cursor-next",
    });
  });

  it("names the questionnaire, with a way to the version history", async () => {
    renderList(serve());

    await findRows();

    expect(screen.getByRole("heading", { level: 1, name: "Responses" })).toBeInTheDocument();
    expect(await screen.findByText("Patient Intake")).toBeInTheDocument();
    expect(screen.queryByText(/not aggregated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not a report/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Version history" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${QUESTIONNAIRE_ID}/versions`,
    );
    expect(screen.getByRole("link", { name: "Back to questionnaires" })).toHaveAttribute("href", "/admin/questionnaires");
  });

  describe("sorting", () => {
    const header = () => screen.getByRole("row", { name: /Session\s+Version/ });
    const columnHeader = (name: string) => within(header()).getByRole("columnheader", { name });
    const sortButton = (name: string) => within(columnHeader(name)).getByRole("button", { name });

    it("marks Started as the descending sort by default and leaves every other column unsorted", async () => {
      renderList(serve());

      await findRows();

      expect(columnHeader("Started")).toHaveAttribute("aria-sort", "descending");
      for (const name of ["Session", "Version", "Status", "Submitted", "Answered"]) {
        expect(columnHeader(name)).not.toHaveAttribute("aria-sort");
      }
    });

    it("makes only the Started and Submitted headers sort controls, as buttons named for their column", async () => {
      renderList(serve());

      await findRows();

      expect(within(header()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Started", "Submitted"]);
      expect(sortButton("Started")).toHaveAttribute("type", "button");
      expect(within(header()).queryByRole("link")).not.toBeInTheDocument();
    });

    it("reads the sort from the URL: marks that column alone, describes it in the caption and requests it", async () => {
      const { requests } = renderList(serve(), "?sort=submitted&order=asc");

      await screen.findByRole("table", { name: /^Sessions, oldest submitted first, in-progress sessions last, 3 on this page$/ });

      expect(columnHeader("Submitted")).toHaveAttribute("aria-sort", "ascending");
      expect(columnHeader("Started")).not.toHaveAttribute("aria-sort");
      expect(sessionQueries(requests)).toEqual([{ sort: "submitted", order: "asc" }]);
    });

    it.each([
      ["", "newest started first"],
      ["?order=asc", "oldest started first"],
      ["?sort=submitted", "newest submitted first, in-progress sessions last"],
      ["?sort=submitted&order=asc", "oldest submitted first, in-progress sessions last"],
    ])("captions the table for %s as %s", async (search, description) => {
      renderList(serve(), search);

      await screen.findByRole("table", { name: `Sessions, ${description}, 3 on this page` });
    });

    it("sorts by the other column, starting descending, when its header is chosen", async () => {
      const { router, requests } = renderList(serve());
      await findRows();

      await userEvent.click(sortButton("Submitted"));

      await waitFor(() => expect(sessionQueries(requests)).toEqual([{}, { sort: "submitted" }]));
      expect(router.state.location.search).toEqual({ sort: "submitted" });
      expect(columnHeader("Submitted")).toHaveAttribute("aria-sort", "descending");
      expect(columnHeader("Started")).not.toHaveAttribute("aria-sort");
    });

    it("toggles the active column between descending and ascending each time its header is chosen", async () => {
      const { router, requests } = renderList(serve());
      await findRows();

      await userEvent.click(sortButton("Started"));
      await waitFor(() => expect(router.state.location.search).toEqual({ order: "asc" }));
      expect(columnHeader("Started")).toHaveAttribute("aria-sort", "ascending");

      await userEvent.click(sortButton("Started"));
      await waitFor(() => expect(router.state.location.search).toEqual({}));
      expect(columnHeader("Started")).toHaveAttribute("aria-sort", "descending");

      expect(sessionQueries(requests)).toEqual([{}, { order: "asc" }, {}]);
    });

    it("starts the other column descending even from an ascending sort, and leaves the defaults off the URL going back", async () => {
      const { router } = renderList(serve(), "?order=asc");
      await findRows();

      await userEvent.click(sortButton("Submitted"));
      await waitFor(() => expect(router.state.location.search).toEqual({ sort: "submitted" }));
      expect(columnHeader("Submitted")).toHaveAttribute("aria-sort", "descending");

      await userEvent.click(sortButton("Started"));
      await waitFor(() => expect(router.state.location.search).toEqual({}));
      expect(columnHeader("Started")).toHaveAttribute("aria-sort", "descending");
    });

    it("can be operated from the keyboard, and the header keeps focus for the next keystroke", async () => {
      const { router, requests } = renderList(serve());
      await findRows();

      sortButton("Submitted").focus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(router.state.location.search).toEqual({ sort: "submitted" }));
      await waitFor(() => expect(sessionQueries(requests)).toHaveLength(2));
      await findRows();
      expect(sortButton("Submitted")).toHaveFocus();

      await userEvent.keyboard(" ");
      await waitFor(() => expect(router.state.location.search).toEqual({ sort: "submitted", order: "asc" }));
      await waitFor(() => expect(sessionQueries(requests)).toHaveLength(3));
      await findRows();
      expect(sortButton("Submitted")).toHaveFocus();
    });

    it("keeps the table on screen, marked busy, and focus on the chosen header while the re-sorted page loads", async () => {
      const resorted = deferred<Response>();
      renderList(holdingWhen((query) => query.get("sort") === "submitted", resorted.promise, serve()));
      await findRows();

      await userEvent.click(sortButton("Submitted"));

      await waitFor(() => expect(tableIsBusy()).toBe(true));
      expect(sortButton("Submitted")).toHaveFocus();
      expect(screen.getByText(shortIdOf(3))).toBeInTheDocument();
      expect(screen.queryByText("Loading sessions…")).not.toBeInTheDocument();

      resorted.resolve(contractResponse(reportingApi.listSessions, 200, aSessionPage([aSessionSummary(1), aSessionSummary(3)])));

      await waitFor(() => expect(tableIsBusy()).toBe(false));
      expect(sortButton("Submitted")).toHaveFocus();
      expect(screen.queryByText(shortIdOf(2))).not.toBeInTheDocument();
    });

    it("announces the order in a polite live region that follows the sort", async () => {
      renderList(serve());
      await findRows();

      expect(screen.getByText("Sorted newest started first")).toHaveAttribute("aria-live", "polite");

      await userEvent.click(sortButton("Submitted"));

      await waitFor(() =>
        expect(screen.getByText("Sorted newest submitted first, in-progress sessions last")).toHaveAttribute("aria-live", "polite"),
      );
    });

    it("goes back to the first page, dropping the cursor, and keeps the filters", async () => {
      const { router, requests } = renderList(
        serve({ pageFor: () => FIRST_PAGE }),
        "?version=1&status=submitted&cursor=cursor-next",
      );
      await findRows();

      await userEvent.click(sortButton("Submitted"));

      await waitFor(() => expect(router.state.location.search).toEqual({ version: 1, status: "submitted", sort: "submitted" }));
      expect(sessionQueries(requests).at(-1)).toEqual({ version: "1", status: "submitted", sort: "submitted" });
    });

    it("survives a filter change, which still drops the cursor", async () => {
      const { router, requests } = renderList(serve({ pageFor: () => FIRST_PAGE }), "?sort=submitted&order=asc&cursor=cursor-next");
      await findRows();

      await userEvent.selectOptions(statusSelect(), "in_progress");

      await waitFor(() => expect(router.state.location.search).toEqual({ status: "in_progress", sort: "submitted", order: "asc" }));
      expect(sessionQueries(requests).at(-1)).toEqual({ status: "in_progress", sort: "submitted", order: "asc" });
    });

    it("lists the rows in the order the server returned them for the sort, rather than re-sorting them", async () => {
      const ascending = aSessionPage([aSessionSummary(1), anInProgressSummary(2), aSessionSummary(3)]);
      const descending = aSessionPage([aSessionSummary(3), aSessionSummary(1), anInProgressSummary(2)]);
      renderList(serve({ pageFor: (query) => (query.get("order") === "asc" ? ascending : descending) }), "?sort=submitted&order=asc");

      const { rows } = await findRows();

      expect(rows.map((row) => cellTexts(row)[0])).toEqual([shortIdOf(1), shortIdOf(2), shortIdOf(3)]);
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

    it.each([
      ["?version=abc"],
      ["?version=0"],
      ["?version=1.5"],
      ["?status=bogus"],
      ["?cursor="],
      ["?sort=id"],
      ["?sort=started_at"],
      ["?sort=asc"],
      ["?order=newest"],
      ["?order=DESC"],
      ["?sort=started&order=desc"],
    ])(
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
      const { router, requests } = renderList(serve({ pages: { "": FIRST_PAGE, "cursor-next": SECOND_PAGE } }), "?cursor=cursor-next");
      await findRows();

      await userEvent.selectOptions(statusSelect(), "submitted");

      await waitFor(() => expect(router.state.location.search).toEqual({ status: "submitted" }));
      expect(sessionQueries(requests)).toEqual([{ cursor: "cursor-next" }, { status: "submitted" }]);
    });
  });

  describe("paging", () => {
    it("enables Next and disables Previous on the first page", async () => {
      renderList(serve());

      await findRows();

      expect(previousButton()).toBeDisabled();
      expect(nextButton()).toBeEnabled();
      expect(screen.getByText("3 sessions on this page")).toBeInTheDocument();
    });

    it("counts a single session in the singular", async () => {
      renderList(serve({ pages: { "": SECOND_PAGE } }));

      await findRows();

      expect(screen.getByText("1 session on this page")).toBeInTheDocument();
    });

    it("enables Previous and disables Next on the last page", async () => {
      renderList(serve({ pages: { "": SECOND_PAGE } }));

      await findRows();

      expect(previousButton()).toBeEnabled();
      expect(nextButton()).toBeDisabled();
    });

    it("enables both in the middle of a long result", async () => {
      renderList(serve({ pages: { "": aSessionPage([aSessionSummary(1)], { next: "n", previous: "p" }) } }));
      await findRows();

      expect(previousButton()).toBeEnabled();
      expect(nextButton()).toBeEnabled();
    });

    it("disables both when everything fits on one page", async () => {
      renderList(serve({ pages: { "": aSessionPage([aSessionSummary(1)]) } }));
      await findRows();

      expect(previousButton()).toBeDisabled();
      expect(nextButton()).toBeDisabled();
    });

    it("follows the next cursor and back again with the previous one, one page at a time", async () => {
      const { router, requests } = renderList(
        serve({ pages: { "": FIRST_PAGE, "cursor-next": SECOND_PAGE, "cursor-previous": FIRST_PAGE } }),
      );
      await findRows();

      await userEvent.click(nextButton());

      await waitFor(() => expect(screen.getByText(shortIdOf(0))).toBeInTheDocument());
      expect(router.state.location.search).toEqual({ cursor: "cursor-next" });
      expect(screen.queryByText(shortIdOf(3))).not.toBeInTheDocument();
      expect(nextButton()).toBeDisabled();

      await userEvent.click(previousButton());

      await waitFor(() => expect(screen.getByText(shortIdOf(3))).toBeInTheDocument());
      expect(router.state.location.search).toEqual({ cursor: "cursor-previous" });
      expect(sessionQueries(requests)).toEqual([{}, { cursor: "cursor-next" }, { cursor: "cursor-previous" }]);
    });

    it("keeps the sort while paging, and pages with the cursor alone as the difference", async () => {
      const { router, requests } = renderList(
        serve({ pages: { "": FIRST_PAGE, "cursor-next": SECOND_PAGE } }),
        "?sort=submitted&order=asc",
      );
      await findRows();

      await userEvent.click(nextButton());

      await waitFor(() => expect(sessionQueries(requests)).toHaveLength(2));
      expect(sessionQueries(requests)[1]).toEqual({ sort: "submitted", order: "asc", cursor: "cursor-next" });
      expect(router.state.location.search).toEqual({ sort: "submitted", order: "asc", cursor: "cursor-next" });
    });

    it("keeps the filters while paging", async () => {
      const { router, requests } = renderList(
        serve({ pages: { "": FIRST_PAGE, "cursor-next": SECOND_PAGE } }),
        "?version=1&status=submitted",
      );
      await findRows();

      await userEvent.click(nextButton());

      await waitFor(() => expect(sessionQueries(requests)).toHaveLength(2));
      expect(sessionQueries(requests)[1]).toEqual({ version: "1", status: "submitted", cursor: "cursor-next" });
      expect(router.state.location.search).toEqual({ version: 1, status: "submitted", cursor: "cursor-next" });
    });
  });

  describe("paging, while the next page loads", () => {
    it("keeps the table and focus on Next while the next page is fetched, instead of unmounting the button", async () => {
      const following = deferred<Response>();
      renderList(holdingWhen((query) => query.get("cursor") === "cursor-next", following.promise, serve()));
      await findRows();
      nextButton().focus();

      await userEvent.click(nextButton());

      await waitFor(() => expect(tableIsBusy()).toBe(true));
      expect(nextButton()).toHaveFocus();
      expect(screen.getByText(shortIdOf(3))).toBeInTheDocument();

      following.resolve(contractResponse(reportingApi.listSessions, 200, SECOND_PAGE));

      await waitFor(() => expect(screen.getByText(shortIdOf(0))).toBeInTheDocument());
      expect(tableIsBusy()).toBe(false);
      expect(nextButton()).toHaveFocus();
    });
  });

  describe("the empty state", () => {
    it("says there are no sessions yet when the questionnaire has none", async () => {
      renderList(serve({ pages: { "": aSessionPage([]) } }));

      const { rows } = await findRows();

      expect(rows).toHaveLength(1);
      expect(screen.getByRole("cell", { name: "No sessions yet." })).toBeInTheDocument();
      expect(screen.getByText("0 sessions on this page")).toBeInTheDocument();
      expect(previousButton()).toBeDisabled();
      expect(nextButton()).toBeDisabled();
    });

    it("says no session matches when a filter is set", async () => {
      renderList(serve({ pages: { "": aSessionPage([]) } }), "?status=in_progress");

      await findRows();

      expect(screen.getByRole("cell", { name: "No sessions match these filters." })).toBeInTheDocument();
      expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Back to the first page" })).not.toBeInTheDocument();
    });

    it("says a page reached by a cursor is empty, rather than that nothing matches, and goes back to the first page keeping the filters and the sort", async () => {
      const { router, requests } = renderList(
        serve({ pages: { "": FIRST_PAGE, "past-the-end": aSessionPage([]) } }),
        "?status=submitted&sort=submitted&order=asc&cursor=past-the-end",
      );
      await findRows();

      expect(screen.getByRole("cell", { name: /There are no sessions on this page/ })).toBeInTheDocument();
      expect(screen.queryByText("No sessions match these filters.")).not.toBeInTheDocument();
      expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();
      expect(previousButton()).toBeDisabled();
      expect(nextButton()).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Back to the first page" }));

      await waitFor(() => expect(screen.getByText(shortIdOf(3))).toBeInTheDocument());
      expect(router.state.location.search).toEqual({ status: "submitted", sort: "submitted", order: "asc" });
      expect(sessionQueries(requests).at(-1)).toEqual({ status: "submitted", sort: "submitted", order: "asc" });
      expect(screen.queryByRole("button", { name: "Back to the first page" })).not.toBeInTheDocument();
    });

    it("offers the way back to the first page with no filter set too, and says loading, not empty, while the first page comes", async () => {
      const first = deferred<Response>();
      const past = contractResponse(reportingApi.listSessions, 200, aSessionPage([]));
      renderList((request) =>
        isReporting(request.url) ? (queryOf(request.url).has("cursor") ? past : first.promise) : serve()(request),
        "?cursor=past-the-end",
      );
      await findRows();

      await userEvent.click(screen.getByRole("button", { name: "Back to the first page" }));

      expect(await screen.findByRole("cell", { name: "Loading sessions…" })).toBeInTheDocument();
      expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();
      expect(tableIsBusy()).toBe(true);

      first.resolve(contractResponse(reportingApi.listSessions, 200, FIRST_PAGE));

      await waitFor(() => expect(screen.getByText(shortIdOf(3))).toBeInTheDocument());
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
