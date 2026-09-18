import type { QuestionnaireSummary } from "@qp/shared";
import { axeViolations, jsonResponse, problemResponse, stubFetch, type RecordedRequest } from "@qp/ui/testing";
import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { questionnaireQueries } from "../../src/api/queries";
import { aDraft, etagAt } from "../support/builders";
import { deferred, draftResponse, routed, type Routes } from "../support/http";
import { renderAppAt, testQueryClient } from "../support/render-app";
import { LIST_URL } from "../support/routes";

const INTAKE_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";
const FOLLOW_UP_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8d0";
const FLU_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8e0";

function aSummary(overrides: Partial<QuestionnaireSummary> & Pick<QuestionnaireSummary, "questionnaireId" | "name">) {
  return {
    key: null,
    currentVersion: 2,
    closesAt: null,
    hasDraft: false,
    createdAt: "2026-01-05T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  } satisfies QuestionnaireSummary;
}

const intake = aSummary({
  questionnaireId: INTAKE_ID,
  name: "Patient Intake",
  key: "qnr_intake",
  hasDraft: true,
  updatedAt: "2026-09-13T09:00:00.000Z",
});
const followUp = aSummary({
  questionnaireId: FOLLOW_UP_ID,
  name: "Post-visit Follow-up",
  currentVersion: null,
  hasDraft: true,
  updatedAt: "2026-09-14T08:00:00.000Z",
});
const flu = aSummary({
  questionnaireId: FLU_ID,
  name: "Flu Season Screening",
  currentVersion: 3,
  closesAt: "2020-03-31T17:00:00.000Z",
  updatedAt: "2020-01-14T10:00:00.000Z",
});

function renderList(routes: Routes, prepare: (queryClient: QueryClient) => void = () => undefined) {
  const requests = stubFetch(routed(routes, () => problemResponse("resource/not-found")));
  const queryClient = testQueryClient();
  prepare(queryClient);
  return { requests, ...renderAppAt("/questionnaires", queryClient) };
}

function namesInOrder(): string[] {
  const [, ...bodyRows] = within(screen.getByRole("table")).getAllByRole("row");
  return bodyRows.map((row) => within(row).getAllByRole("cell")[0]?.querySelector("span")?.textContent ?? "");
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("cell", { name: new RegExp(`^${name}`) }).closest("tr");
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

function callsTo(requests: RecordedRequest[]) {
  return requests.map(({ method, url }) => `${method} ${url}`);
}

describe("the questionnaire list", () => {
  it("sorts the rows by updatedAt, newest first, whatever order the server sent them in", async () => {
    renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [flu, intake, followUp]) });

    await screen.findByRole("table");

    expect(namesInOrder()).toEqual(["Post-visit Follow-up", "Patient Intake", "Flu Season Screening"]);
    expect(screen.getByText("3 questionnaires · most recently edited first")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Last edited" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows each row's status, draft, closing date and key", async () => {
    renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [flu, intake, followUp]) });

    await screen.findByRole("table");

    expect(within(rowOf("Patient Intake")).getByText("Published v2")).toBeInTheDocument();
    expect(within(rowOf("Patient Intake")).getByText("qnr_intake")).toBeInTheDocument();
    expect(within(rowOf("Patient Intake")).getByText("Draft open")).toBeInTheDocument();
    expect(within(rowOf("Patient Intake")).getByText("Open-ended")).toBeInTheDocument();
    expect(within(rowOf("Post-visit Follow-up")).getByText("Never published")).toBeInTheDocument();
    expect(within(rowOf("Post-visit Follow-up")).queryByRole("link", { name: /History/ })).not.toBeInTheDocument();
    expect(within(rowOf("Flu Season Screening")).getByText("Closed at v3")).toBeInTheDocument();
    expect(within(rowOf("Flu Season Screening")).getByRole("button", { name: "Reopen Flu Season Screening" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History of Patient Intake" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${INTAKE_ID}/versions`,
    );
  });

  it("links the name to the questionnaire, and lets you copy that link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [intake]) });

    await screen.findByRole("table");

    const nameLink = within(rowOf("Patient Intake")).getByRole("link", { name: "Patient Intake" });
    expect(nameLink).toHaveAttribute("href", `${window.location.origin}/q/${INTAKE_ID}`);
    expect(nameLink).toHaveAttribute("target", "_blank");

    await userEvent.click(within(rowOf("Patient Intake")).getByRole("button", { name: "Copy link to Patient Intake" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/q/${INTAKE_ID}`);
  });

  it("doesn't link the name or offer a copy-link button once a questionnaire is closed, showing an archived mark instead", async () => {
    renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [flu]) });

    await screen.findByRole("table");

    const row = rowOf("Flu Season Screening");
    expect(within(row).queryByRole("link", { name: "Flu Season Screening" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
    expect(within(row).getByText("Flu Season Screening")).toBeInTheDocument();
    expect(within(row).getByLabelText("Flu Season Screening is archived")).toBeInTheDocument();
  });

  it("reads closed and last edited as of when the list was loaded, and again when a refetch lands", async () => {
    const loadedAt = Date.parse("2026-01-14T12:00:00.000Z");
    const closingSoon = aSummary({
      questionnaireId: INTAKE_ID,
      name: "Patient Intake",
      closesAt: "2026-01-14T12:05:00.000Z",
      updatedAt: "2026-01-14T11:58:00.000Z",
    });
    const refetch = deferred<Response>();
    renderList({ [`GET ${LIST_URL}`]: () => refetch.promise }, (queryClient) =>
      queryClient.setQueryData(questionnaireQueries.list().queryKey, [closingSoon], { updatedAt: loadedAt }),
    );

    await screen.findByRole("table");
    expect(within(rowOf("Patient Intake")).getByText("Published v2")).toBeInTheDocument();
    expect(within(rowOf("Patient Intake")).getByText("2 minutes ago")).toBeInTheDocument();

    refetch.resolve(jsonResponse(200, [closingSoon]));

    expect(await within(rowOf("Patient Intake")).findByText("Closed at v2")).toBeInTheDocument();
    expect(within(rowOf("Patient Intake")).queryByText("2 minutes ago")).not.toBeInTheDocument();
  });

  describe("while the screen stays open", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-requests the list every minute and turns a row closed once the refreshed load passes its closesAt", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(Date.parse("2026-01-14T12:04:30.000Z"));
      const closingSoon = aSummary({
        questionnaireId: INTAKE_ID,
        name: "Patient Intake",
        closesAt: "2026-01-14T12:05:00.000Z",
      });
      const { requests } = renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [closingSoon]) });
      const listRequests = () => callsTo(requests).filter((call) => call === `GET ${LIST_URL}`);

      await screen.findByRole("table");
      expect(within(rowOf("Patient Intake")).getByText("Published v2")).toBeInTheDocument();
      expect(listRequests()).toHaveLength(1);

      await act(() => vi.advanceTimersByTimeAsync(59_000));
      expect(listRequests()).toHaveLength(1);

      await act(() => vi.advanceTimersByTimeAsync(1_000));

      await waitFor(() => expect(listRequests()).toHaveLength(2));
      expect(await within(rowOf("Patient Intake")).findByText("Closed at v2")).toBeInTheDocument();
    });
  });

  it("shows a loading state until the list arrives", async () => {
    const response = deferred<Response>();
    renderList({ [`GET ${LIST_URL}`]: () => response.promise });

    expect(await screen.findByRole("status")).toHaveTextContent("Loading questionnaires…");

    response.resolve(jsonResponse(200, [intake]));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no questionnaires", async () => {
    renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, []) });

    expect(await screen.findByText("No questionnaires yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New questionnaire" })).toBeInTheDocument();
  });

  it("shows an error state with a retry that loads the list", async () => {
    const responses = [problemResponse("internal", { detail: "trace-1" }), jsonResponse(200, [intake])];
    renderList({ [`GET ${LIST_URL}`]: () => responses.shift() ?? jsonResponse(200, [intake]) });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The questionnaires could not be loaded.");

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("creating a questionnaire", () => {
  it("asks for a name and a title, sends no key, then invalidates the list and navigates to the new draft", async () => {
    const created = aSummary({
      questionnaireId: FOLLOW_UP_ID,
      name: "PR1 Allergy check",
      currentVersion: null,
      hasDraft: true,
    });
    const { requests, router } = renderList({
      [`GET ${LIST_URL}`]: () => jsonResponse(200, [intake]),
      [`POST ${LIST_URL}`]: () => jsonResponse(201, created),
    });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "New questionnaire" }));
    const dialog = await screen.findByRole("dialog", { name: "New questionnaire" });
    expect(within(dialog).queryByRole("textbox", { name: /key/i })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Create questionnaire" }));

    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveFocus();
    expect(callsTo(requests)).not.toContain(`POST ${LIST_URL}`);

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "  PR1 Allergy check ");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Allergy check");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create questionnaire" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/questionnaires/${FOLLOW_UP_ID}/draft`));
    const post = requests.find(({ method, url }) => method === "POST" && url === LIST_URL);
    expect(post?.body).toEqual({ name: "PR1 Allergy check", title: "Allergy check" });
    expect(callsTo(requests).filter((call) => call === `GET ${LIST_URL}`).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the dialog open with an error when the create fails", async () => {
    const { router } = renderList({
      [`GET ${LIST_URL}`]: () => jsonResponse(200, [intake]),
      [`POST ${LIST_URL}`]: () => problemResponse("internal", { detail: "trace-2" }),
    });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "New questionnaire" }));
    const dialog = await screen.findByRole("dialog", { name: "New questionnaire" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "PR1 Broken");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Broken");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create questionnaire" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The questionnaire was not created.");
    expect(router.state.location.pathname).toBe("/questionnaires");
  });
});

describe("opening a draft", () => {
  const published = aSummary({ questionnaireId: INTAKE_ID, name: "Patient Intake", hasDraft: false });
  const DRAFT_URL = `${LIST_URL}/${INTAKE_ID}/draft`;

  it("navigates straight to the draft when one is open, without writing anything", async () => {
    const { requests, router } = renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [intake]) });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Open draft of Patient Intake" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/questionnaires/${INTAKE_ID}/draft`));
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
  });

  it("opens the next draft when none is open, caches it with its ETag and navigates to it", async () => {
    const { requests, queryClient, router } = renderList({
      [`GET ${LIST_URL}`]: () => jsonResponse(200, [published]),
      [`POST ${DRAFT_URL}`]: () => draftResponse(aDraft(), 3, 201),
    });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Open draft of Patient Intake" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/questionnaires/${INTAKE_ID}/draft`));
    expect(callsTo(requests)).toContain(`POST ${DRAFT_URL}`);
    expect(queryClient.getQueryData(questionnaireQueries.draft(INTAKE_ID).queryKey)).toEqual({
      draft: aDraft(),
      etag: etagAt(3),
    });
  });

  it("on 409 questionnaire/draft-exists refetches the draft that now exists and navigates to it, showing no error", async () => {
    const theirs = aDraft(["itm_09"]);
    const { requests, queryClient, router } = renderList({
      [`GET ${LIST_URL}`]: () => jsonResponse(200, [published]),
      [`POST ${DRAFT_URL}`]: () => problemResponse("questionnaire/draft-exists"),
      [`GET ${DRAFT_URL}`]: () => draftResponse(theirs, 5),
    });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Open draft of Patient Intake" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/questionnaires/${INTAKE_ID}/draft`));
    const calls = callsTo(requests);
    expect(calls.indexOf(`GET ${DRAFT_URL}`)).toBeGreaterThan(calls.indexOf(`POST ${DRAFT_URL}`));
    expect(calls.filter((call) => call === `GET ${LIST_URL}`).length).toBeGreaterThanOrEqual(2);
    expect(queryClient.getQueryData(questionnaireQueries.draft(INTAKE_ID).queryKey)).toEqual({
      draft: theirs,
      etag: etagAt(5),
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports any other failure to open a draft and stays on the list", async () => {
    const { router } = renderList({
      [`GET ${LIST_URL}`]: () => jsonResponse(200, [published]),
      [`POST ${DRAFT_URL}`]: () => problemResponse("internal", { detail: "trace-3" }),
    });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Open draft of Patient Intake" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The draft of Patient Intake could not be opened.");
    expect(router.state.location.pathname).toBe("/questionnaires");
  });
});

describe("retiring and reopening", () => {
  const CLOSES_AT_URL = `${LIST_URL}/${INTAKE_ID}/closes-at`;
  const open = aSummary({ questionnaireId: INTAKE_ID, name: "Patient Intake" });

  it("sets closesAt through PUT /closes-at, updates the row from the response, then clears it again", async () => {
    const closesAt = new Date("2020-06-01T09:30").toISOString();
    const { requests } = renderList({
      [`GET ${LIST_URL}`]: () => jsonResponse(200, [open]),
      [`PUT ${CLOSES_AT_URL}`]: ({ body }) =>
        jsonResponse(200, { ...open, closesAt: body !== null && typeof body === "object" && "closesAt" in body ? body.closesAt : null }),
    });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Retire Patient Intake" }));
    const retire = await screen.findByRole("dialog", { name: "Retire Patient Intake" });
    expect(within(retire).queryByRole("button", { name: "Clear closing date" })).not.toBeInTheDocument();
    fireEvent.change(within(retire).getByLabelText("Closes at"), { target: { value: "2020-06-01T09:30" } });
    await userEvent.click(within(retire).getByRole("button", { name: "Save closing date" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowOf("Patient Intake")).getByText("Closed at v2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reopen Patient Intake" }));
    const reopen = await screen.findByRole("dialog", { name: "Reopen Patient Intake" });
    expect(within(reopen).getByLabelText("Closes at")).toHaveValue("2020-06-01T09:30");
    await userEvent.click(within(reopen).getByRole("button", { name: "Clear closing date" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowOf("Patient Intake")).getByText("Published v2")).toBeInTheDocument();
    expect(within(rowOf("Patient Intake")).getByText("Open-ended")).toBeInTheDocument();
    expect(requests.filter(({ method }) => method === "PUT").map(({ url, body }) => ({ url, body }))).toEqual([
      { url: CLOSES_AT_URL, body: { closesAt } },
      { url: CLOSES_AT_URL, body: { closesAt: null } },
    ]);
    expect(callsTo(requests).filter((call) => call === `GET ${LIST_URL}`)).toHaveLength(1);
  });

  it("schedules a future close as a reschedulable open row", async () => {
    const future = aSummary({ questionnaireId: INTAKE_ID, name: "Patient Intake", closesAt: "2999-01-01T00:00:00.000Z" });
    renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [future]) });
    await screen.findByRole("table");

    expect(within(rowOf("Patient Intake")).getByText("Published v2")).toBeInTheDocument();
    expect(within(rowOf("Patient Intake")).getByRole("button", { name: "Reschedule Patient Intake" })).toBeInTheDocument();
  });

  it("keeps the dialog open with an error when the write fails", async () => {
    renderList({
      [`GET ${LIST_URL}`]: () => jsonResponse(200, [open]),
      [`PUT ${CLOSES_AT_URL}`]: () => problemResponse("internal", { detail: "trace-4" }),
    });
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Retire Patient Intake" }));
    const dialog = await screen.findByRole("dialog", { name: "Retire Patient Intake" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save closing date" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The closing date was not saved.");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowOf("Patient Intake")).getByText("Published v2")).toBeInTheDocument();
  });
});

describe("the questionnaire list's accessibility", () => {
  it("has no axe violations with rows, or with the create and closing-date dialogs open", async () => {
    const { container } = renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, [flu, intake, followUp]) });
    await screen.findByRole("table");

    expect(await axeViolations(container)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "New questionnaire" }));
    expect(await axeViolations(await screen.findByRole("dialog"))).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Reopen Flu Season Screening" }));
    expect(await axeViolations(await screen.findByRole("dialog"))).toEqual([]);
  });

  it("has no axe violations in the empty state", async () => {
    const { container } = renderList({ [`GET ${LIST_URL}`]: () => jsonResponse(200, []) });
    await screen.findByText("No questionnaires yet");

    expect(await axeViolations(container)).toEqual([]);
  });
});
