import { reportingApi, type QuestionnaireSummary, type SessionDetail, type SessionSummaryPage, type VersionSummary } from "@qp/shared";
import { axeViolations, contractResponse, jsonResponse, problemResponse, stubFetch, type Reply } from "@qp/ui/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { renderAppAt } from "../support/render-app";
import {
  YES_CONDITION_STATES,
  aSessionDetail,
  aSessionPage,
  aSessionSummary,
  sessionIdOf,
  shortIdOf,
  startedAtOf,
} from "../support/reporting";
import { LIST_URL, VERSIONS_URL, sessionUrl } from "../support/routes";

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

const LATEST_IS_2 = [aVersion(2), aVersion(1)];

interface Serving {
  details?: SessionDetail[];
  detail?: () => Response;
  page?: SessionSummaryPage;
  pageFor?: (query: URLSearchParams) => SessionSummaryPage;
  versions?: () => Response;
}

function serve({
  details = [aSessionDetail(1)],
  detail,
  page = aSessionPage([aSessionSummary(1)]),
  pageFor = () => page,
  versions = () => jsonResponse(200, LATEST_IS_2),
}: Serving = {}): Reply {
  return ({ url }) => {
    if (url === LIST_URL) return jsonResponse(200, [SUMMARY]);
    if (url === VERSIONS_URL) return versions();
    if (url.split("?")[0]?.endsWith("/responses")) {
      const query = new URL(url, "http://localhost").searchParams;
      return contractResponse(reportingApi.listSessions, 200, pageFor(query));
    }
    const found = details.find((candidate) => url === sessionUrl(candidate.sessionId));
    if (found !== undefined || detail !== undefined) {
      return detail === undefined ? contractResponse(reportingApi.getSessionDetail, 200, found) : detail();
    }
    throw new Error(`unexpected request to ${url}`);
  };
}

function renderDetail(handler: Reply, n = 1, search = "") {
  const requests = stubFetch(handler);
  return { requests, ...renderAppAt(`/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(n)}${search}`) };
}

async function findItems() {
  const list = await screen.findByRole("list");
  return within(list).getAllByRole("listitem");
}

function itemFor(prompt: string): HTMLElement {
  const item = screen.getByText(prompt).closest("li");
  if (item === null) throw new Error(`no item for "${prompt}"`);
  return item;
}

function sessionPanel(): HTMLElement {
  return screen.getByRole("region", { name: "Session" });
}

function panelValue(term: string): HTMLElement {
  const row = within(sessionPanel()).getByText(term, { selector: "dt" }).closest("div");
  const value = row?.querySelector("dd");
  if (value === null || value === undefined) throw new Error(`no value for "${term}"`);
  return value;
}

const PROMPTS = {
  hasCondition: "Do you have a medical condition?",
  whichCondition: "Which condition?",
  diagnosedOn: "When were you diagnosed?",
  pharmacy: "Preferred pharmacy",
};

describe("the response detail screen", () => {
  describe("the answers of a submitted session", () => {
    it("lists every item of the pinned version in order, with its question type, pinned version, rule and requirement", async () => {
      renderDetail(serve());

      const items = await findItems();

      expect(items).toHaveLength(4);
      expect(items.map((item) => within(item).getByText(/pinned v/).textContent)).toEqual([
        "Single choice · pinned v1 · Always shown · Required",
        "Single choice · pinned v3 · Shown when 1 condition is true · Required",
        "Date · pinned v1 · Shown when 1 condition is true · Required",
        "Text · pinned v1 · Always shown · Required",
      ]);
      expect(items.map((item) => item.querySelector(".font-medium")?.textContent)).toEqual(Object.values(PROMPTS));
    });

    it("shows an answered item with its label and the id it is stored as", async () => {
      renderDetail(serve());

      await findItems();

      const answered = itemFor(PROMPTS.hasCondition);
      expect(within(answered).getByText("No")).toBeInTheDocument();
      expect(within(answered).getByText("no")).toBeInTheDocument();
      expect(within(itemFor(PROMPTS.pharmacy)).getByText("Corner Pharmacy")).toBeInTheDocument();
      expect(within(answered).queryByText("Hidden by rules")).not.toBeInTheDocument();
      expect(within(answered).queryByText("Not answered")).not.toBeInTheDocument();
    });

    it("shows an item its rules hid as Hidden by rules, with no answer beside it", async () => {
      renderDetail(serve());

      await findItems();

      for (const prompt of [PROMPTS.whichCondition, PROMPTS.diagnosedOn]) {
        const hidden = itemFor(prompt);
        expect(within(hidden).getByText("Hidden by rules")).toBeInTheDocument();
        expect(within(hidden).queryByText("Not answered")).not.toBeInTheDocument();
      }
      expect(screen.getAllByText("Hidden by rules")).toHaveLength(2);
    });

    it("tells an item that was shown but left unanswered apart from one that was hidden", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { states: YES_CONDITION_STATES })] }));

      await findItems();

      expect(within(itemFor(PROMPTS.pharmacy)).getByText("Not answered")).toBeInTheDocument();
      expect(within(itemFor(PROMPTS.pharmacy)).queryByText("Hidden by rules")).not.toBeInTheDocument();
      expect(screen.queryByText("Hidden by rules")).not.toBeInTheDocument();
    });

    it("shows the pinned version's own labels for the answers on a session collected under version 2", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { version: 2, states: YES_CONDITION_STATES })] }));

      await findItems();

      expect(within(itemFor(PROMPTS.whichCondition)).getByText("High blood pressure (hypertension)")).toBeInTheDocument();
      expect(within(itemFor(PROMPTS.whichCondition)).getByText("opt_hyperten")).toBeInTheDocument();
      expect(within(itemFor(PROMPTS.whichCondition)).getByText(/pinned v4/)).toBeInTheDocument();
    });

    it("shows a date answer as the calendar day it was stored as", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { states: YES_CONDITION_STATES })] }));

      await findItems();

      const answered = itemFor(PROMPTS.diagnosedOn);
      expect(within(answered).getByText("29 Feb 2020")).toBeInTheDocument();
      expect(within(answered).getByText("2020-02-29")).toBeInTheDocument();
    });
  });

  describe("an in-progress session", () => {
    it("says nothing is stored yet, and shows every item as not stored until submit", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { status: "in_progress" })] }));

      const items = await findItems();

      expect(screen.getByRole("status")).toHaveTextContent("No answers are stored for this session yet");
      expect(items.map((item) => within(item).getByText("Not stored until submit").textContent)).toEqual(Array(4).fill("Not stored until submit"));
      expect(screen.queryByText("Not answered")).not.toBeInTheDocument();
    });

    it("never reports an item as hidden, because visibility is only decided from stored answers", async () => {
      const base = aSessionDetail(1, { status: "in_progress" });
      renderDetail(serve({ details: [{ ...base, items: base.items.map((item) => ({ ...item, visible: false })) }] }));

      await findItems();

      expect(screen.queryByText("Hidden by rules")).not.toBeInTheDocument();
      expect(screen.getAllByText("Not stored until submit")).toHaveLength(4);
    });

    it("shows a dash for the submit time and no stored answers in the Session panel", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { status: "in_progress" })] }));

      await findItems();

      expect(panelValue("Status")).toHaveTextContent("In progress");
      expect(panelValue("Submitted")).toHaveTextContent("—");
      expect(within(panelValue("Submitted")).queryByRole("time")).not.toBeInTheDocument();
      expect(panelValue("Stored answers")).toHaveTextContent("None until submit");
    });

    it("does not show the in-progress notice for a submitted session", async () => {
      renderDetail(serve());

      await findItems();

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByText("Not stored until submit")).not.toBeInTheDocument();
    });
  });

  describe("the Session panel and header", () => {
    it("shows the 8-character session id in the title and the panel, never the full id", async () => {
      renderDetail(serve({ details: [aSessionDetail(0xa1b2c3)] }), 0xa1b2c3);

      await findItems();

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`Session ${shortIdOf(0xa1b2c3)}`);
      expect(panelValue("Session id")).toHaveTextContent(new RegExp(`^${shortIdOf(0xa1b2c3)}$`));
      expect(screen.queryByText(sessionIdOf(0xa1b2c3))).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(sessionIdOf(0xa1b2c3));
    });

    it("names the questionnaire and the version it was collected under, and links to that version", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { version: 2 })] }));

      await findItems();

      expect(screen.getByText("Patient Intake · version 2")).toBeInTheDocument();
      expect(screen.queryByText(/not aggregated/i)).not.toBeInTheDocument();
      expect(within(sessionPanel()).getByRole("link", { name: "Version 2" })).toHaveAttribute(
        "href",
        `/admin/questionnaires/${QUESTIONNAIRE_ID}/versions/2`,
      );
    });

    it("shows the status, both times and how many questions have stored answers", async () => {
      renderDetail(serve());

      await findItems();

      expect(panelValue("Status")).toHaveTextContent("Submitted");
      expect(within(panelValue("Started")).getByRole("time")).toHaveAttribute("datetime", startedAtOf(1));
      expect(within(panelValue("Submitted")).getByRole("time")).toHaveAttribute("datetime", startedAtOf(2));
      expect(panelValue("Stored answers")).toHaveTextContent("2 of 4 questions");
    });

    it("links back to the responses list, keeping the filters it was opened with", async () => {
      renderDetail(serve(), 1, "?status=submitted&version=1");

      const back = await screen.findByRole("link", { name: "Back to responses" });
      const href = new URL(back.getAttribute("href") ?? "", "http://localhost");

      expect(href.pathname).toBe(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses`);
      expect(href.searchParams.get("status")).toBe("submitted");
      expect(href.searchParams.get("version")).toBe("1");
    });
  });

  describe("the version pin note", () => {
    it("appears when the session's version is not the latest, naming both", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { version: 1 })] }));

      const note = await screen.findByRole("note");

      expect(note).toHaveTextContent("This session is pinned to version 1.");
      expect(note).toHaveTextContent("The questionnaire has since moved to version 2");
    });

    it("is absent when the session is on the latest version", async () => {
      renderDetail(serve({ details: [aSessionDetail(1, { version: 2 })] }));

      await findItems();
      await waitFor(() => expect(screen.queryByRole("note")).not.toBeInTheDocument());
      expect(screen.getByText("Patient Intake · version 2")).toBeInTheDocument();
    });

    it("is absent when the version history cannot be read, rather than guessing", async () => {
      renderDetail(serve({ versions: () => problemResponse("internal", { detail: "boom" }) }));

      await findItems();

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });
  });

  describe("moving between sessions", () => {
    const three = aSessionPage([aSessionSummary(3), aSessionSummary(2), aSessionSummary(1)]);
    const details = [aSessionDetail(3), aSessionDetail(2), aSessionDetail(1)];

    it("links to the previous and next neighbours on the page, keeping the filters, and says where this one sits", async () => {
      renderDetail(serve({ details, page: three }), 2, "?status=submitted");

      const previous = await screen.findByRole("link", { name: /Previous session/ });
      const next = screen.getByRole("link", { name: /Next session/ });

      expect(await screen.findByText("2 of 3 on this page")).toBeInTheDocument();
      for (const [link, neighbour] of [[previous, 3], [next, 1]] as const) {
        const href = new URL(link.getAttribute("href") ?? "", "http://localhost");
        expect(href.pathname).toBe(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(neighbour)}`);
        expect(href.searchParams.get("status")).toBe("submitted");
      }
    });

    it("opens the next session when Next session is followed, and then has no next one to offer if it was the last", async () => {
      const { router } = renderDetail(serve({ details, page: three }), 2);

      await userEvent.click(await screen.findByRole("link", { name: /Next session/ }));

      expect(await screen.findByRole("heading", { level: 1, name: new RegExp(`Session ${shortIdOf(1)}`) })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(`/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(1)}`);
      expect(await screen.findByText("3 of 3 on this page")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next session/ })).toBeDisabled();
      expect(screen.getByRole("link", { name: /Previous session/ })).toBeInTheDocument();
    });

    it("has no previous session to offer on the first row of a page", async () => {
      renderDetail(serve({ details, page: three }), 3);

      expect(await screen.findByText("1 of 3 on this page")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Previous session/ })).toBeDisabled();
      expect(screen.getByRole("link", { name: /Next session/ })).toBeInTheDocument();
    });

    it("offers neither, and no position, for the only session on a page", async () => {
      renderDetail(serve());

      expect(await screen.findByText("1 of 1 on this page")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Previous session/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Next session/ })).toBeDisabled();
    });

    it("offers neither, and no position, when the session is not on the page it was opened from", async () => {
      renderDetail(serve({ details, page: aSessionPage([aSessionSummary(9)]) }), 2);

      await findItems();

      await waitFor(() => expect(screen.queryByText(/on this page/)).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: /Previous session/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Next session/ })).toBeDisabled();
    });
  });

  describe("moving between sessions in a sorted list", () => {
    const details = [aSessionDetail(1), aSessionDetail(2), aSessionDetail(3)];
    const ascending = aSessionPage([aSessionSummary(1), aSessionSummary(2), aSessionSummary(3)]);
    const descending = aSessionPage([aSessionSummary(3), aSessionSummary(2), aSessionSummary(1)]);
    const byOrder = (query: URLSearchParams) => (query.get("order") === "asc" ? ascending : descending);

    function hrefOf(link: HTMLElement): URL {
      return new URL(link.getAttribute("href") ?? "", "http://localhost");
    }

    it("asks the list for the same sort, order, filters and cursor the session was opened from", async () => {
      const { requests } = renderDetail(
        serve({ details, pageFor: byOrder }),
        2,
        "?status=submitted&version=1&sort=submitted&order=asc&cursor=cursor-next",
      );

      await screen.findByText("2 of 3 on this page");

      const listRequests = requests.filter(({ url }) => url.split("?")[0]?.endsWith("/responses"));
      expect(listRequests.map(({ url }) => Object.fromEntries(new URL(url, "http://localhost").searchParams))).toEqual([
        { status: "submitted", version: "1", sort: "submitted", order: "asc", cursor: "cursor-next" },
      ]);
    });

    it("takes Previous and Next from the sorted page, so an ascending page reverses them against a descending one", async () => {
      renderDetail(serve({ details, pageFor: byOrder }), 2, "?sort=submitted&order=asc");

      const previous = await screen.findByRole("link", { name: /Previous session/ });
      const next = screen.getByRole("link", { name: /Next session/ });

      expect(hrefOf(previous).pathname).toBe(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(1)}`);
      expect(hrefOf(next).pathname).toBe(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(3)}`);
    });

    it("does the opposite for the descending page of the same sessions", async () => {
      renderDetail(serve({ details, pageFor: byOrder }), 2, "?sort=submitted");

      const previous = await screen.findByRole("link", { name: /Previous session/ });
      const next = screen.getByRole("link", { name: /Next session/ });

      expect(hrefOf(previous).pathname).toBe(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(3)}`);
      expect(hrefOf(next).pathname).toBe(`/admin/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(1)}`);
    });

    it("keeps the sort, order, filters and cursor on both neighbours and on the way back to the list", async () => {
      renderDetail(serve({ details, pageFor: byOrder }), 2, "?status=submitted&sort=submitted&order=asc&cursor=cursor-next");

      const links = [
        await screen.findByRole("link", { name: /Previous session/ }),
        screen.getByRole("link", { name: /Next session/ }),
        screen.getByRole("link", { name: "Back to responses" }),
      ];

      for (const link of links) {
        expect(Object.fromEntries(hrefOf(link).searchParams)).toEqual({
          status: "submitted",
          sort: "submitted",
          order: "asc",
          cursor: "cursor-next",
        });
      }
    });

    it("carries the sort through to the next session when Next session is followed", async () => {
      const { router, requests } = renderDetail(serve({ details, pageFor: byOrder }), 2, "?sort=submitted&order=asc");

      await userEvent.click(await screen.findByRole("link", { name: /Next session/ }));

      expect(await screen.findByRole("heading", { level: 1, name: new RegExp(`Session ${shortIdOf(3)}`) })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ sort: "submitted", order: "asc" });
      expect(await screen.findByText("3 of 3 on this page")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next session/ })).toBeDisabled();
      expect(requests.some(({ url }) => url.includes("sort=submitted") && url.includes("order=asc"))).toBe(true);
    });
  });

  describe("loading and failure", () => {
    it("shows a loading state until the session arrives", async () => {
      let answer: (response: Response) => void = () => undefined;
      const pending = new Promise<Response>((settle) => {
        answer = settle;
      });
      renderDetail((request) => (request.url === sessionUrl(sessionIdOf(1)) ? pending : serve()(request)));

      expect(await screen.findByRole("status")).toHaveTextContent("Loading session");

      answer(contractResponse(reportingApi.getSessionDetail, 200, aSessionDetail(1)));

      await findItems();
      expect(screen.queryByText("Loading session…")).not.toBeInTheDocument();
    });

    it("says a session that does not exist, or belongs to another questionnaire, was not found, with a way back", async () => {
      renderDetail(serve({ detail: () => problemResponse("resource/not-found") }));

      expect(await screen.findByRole("heading", { level: 1, name: "Session not found" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("This session could not be found.");
      expect(screen.getByRole("link", { name: "Back to responses" })).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });

    it("reports a failed load and retries it on request", async () => {
      let failures = 1;
      const { requests } = renderDetail(
        serve({
          detail: () =>
            failures-- > 0 ? problemResponse("internal", { detail: "boom" }) : contractResponse(reportingApi.getSessionDetail, 200, aSessionDetail(1)),
        }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent("This session could not be loaded.");
      expect(screen.queryByText("This session could not be found.")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(await findItems()).toHaveLength(4);
      expect(requests.filter(({ url }) => url === sessionUrl(sessionIdOf(1)))).toHaveLength(2);
    });

    it("answers 404 for a session id that is not a uuid without asking the server", async () => {
      const requests = stubFetch(serve());
      renderAppAt(`/questionnaires/${QUESTIONNAIRE_ID}/responses/not-a-uuid`);

      expect(await screen.findByText("Page not found")).toBeInTheDocument();
      expect(requests.filter(({ url }) => url.startsWith(reportingApi.REPORTING_PREFIX))).toEqual([]);
    });
  });

  it("has no axe violations", async () => {
    const { container } = renderDetail(serve({ details: [aSessionDetail(1, { states: YES_CONDITION_STATES })] }));
    await findItems();

    expect(await axeViolations(container)).toEqual([]);
  });
});
