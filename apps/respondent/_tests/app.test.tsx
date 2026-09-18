import { problem, type ClientAnswers, type ItemError, type SubmissionItemCode } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app.tsx";
import { partialsKey, readPartials, writePartials } from "../src/storage/partials.ts";
import { axeViolations } from "./axe.ts";
import { ExecutionServer, heldReply, jsonReply, networkFailure, problemReply } from "./execution-server.ts";
import { ANSWER_SENTINEL, inProgressSession, intakeV1, receipt, SESSION_ID, submittedSession } from "./fixtures.ts";

const STALE_SESSION_ID = "0b0b0b0b-1b3d-4e8f-a6c5-9d0b1e2f3a4b";
const intakePath = `/q/${INTAKE_QUESTIONNAIRE_ID}`;
const sessionsUrl = "/api/run/sessions";
const sessionUrl = `/api/run/sessions/${SESSION_ID}`;
const submitUrl = `${sessionUrl}/submit`;

let server: ExecutionServer;

beforeEach(() => {
  server = new ExecutionServer();
  vi.stubGlobal("fetch", server.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderApp(pathname = intakePath) {
  return render(
    <StrictMode>
      <App pathname={pathname} />
    </StrictMode>,
  );
}

function storeSession(sessionId: string, answers: ClientAnswers) {
  writePartials({ sessionId, questionnaireId: INTAKE_QUESTIONNAIRE_ID }, answers);
}

function storedAnswers() {
  return readPartials(INTAKE_QUESTIONNAIRE_ID)?.answers;
}

function group(name: RegExp) {
  return screen.getByRole("radiogroup", { name });
}

const hasCondition = () => group(/Do you have a medical condition\?/);
const whichCondition = () => group(/Which condition\?/);
const diagnosedOn = () => screen.getByLabelText("When were you diagnosed?", { exact: false });
const pharmacy = () => screen.getByLabelText("Preferred pharmacy", { exact: false });
const submitButton = () => screen.getByRole("button", { name: /Submit/ });
const tryAgain = () => screen.getByRole("button", { name: /^(Try again|Trying again…)$/ });
const startNewSession = () => screen.getByRole("button", { name: /^(Start a new session|Starting a new session…)$/ });
const loadFailedHeading ={ level: 1, name: "The questionnaire could not be loaded" } as const;

async function startFresh() {
  server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
  renderApp();
  return screen.findByRole("heading", { level: 1, name: "Patient Intake" });
}

async function answerYesBranch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(hasCondition()).getByRole("radio", { name: "Yes" }));
  await user.click(within(whichCondition()).getByRole("radio", { name: "Diabetes" }));
  fireEvent.change(diagnosedOn(), { target: { value: "2019-04-02" } });
  await user.type(pharmacy(), "Corner pharmacy");
}

describe("entering at /q/:questionnaireId with nothing stored", () => {
  it("starts one session, even under StrictMode, and persists the envelope before any answer", async () => {
    await startFresh();

    expect(server.sent("POST", sessionsUrl)).toEqual([
      { method: "POST", url: sessionsUrl, body: { questionnaireId: INTAKE_QUESTIONNAIRE_ID } },
    ]);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
    expect(screen.queryByText(/We restored the answers/)).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("shows the closed screen on 409 questionnaire/closed", async () => {
    server.on("POST", sessionsUrl, problemReply(problem("questionnaire/closed")));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "This questionnaire is closed" })).toBeInTheDocument();
  });

  it("shows the not-found screen on 404", async () => {
    server.on("POST", sessionsUrl, problemReply(problem("resource/not-found")));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Questionnaire not found" })).toBeInTheDocument();
  });

  it.each(["/", "/q/", "/q/not-a-uuid", `/q/${INTAKE_QUESTIONNAIRE_ID}/extra`, "/q/%E0%A4%A"])(
    "shows the not-found screen for %s without calling the API",
    (pathname) => {
      renderApp(pathname);

      expect(screen.getByRole("heading", { level: 1, name: "Questionnaire not found" })).toBeInTheDocument();
      expect(server.fetch).not.toHaveBeenCalled();
    },
  );

  it("shows the generic error screen with no retry on a problem repeating the request cannot fix", async () => {
    server.on("POST", sessionsUrl, problemReply(problem("request/invalid", { errors: [] })));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("filling the intake form", () => {
  it("reveals the branch on yes, submits, shows the receipt and keeps only the ids in storage", async () => {
    const user = userEvent.setup();
    await startFresh();
    expect(screen.queryByRole("radiogroup", { name: /Which condition\?/ })).not.toBeInTheDocument();

    await answerYesBranch(user);
    expect(storedAnswers()).toEqual({
      itm_01: { type: "single_choice", optionId: "yes" },
      itm_02: { type: "single_choice", optionId: "opt_diabetes" },
      itm_03: { type: "date", date: "2019-04-02" },
      itm_04: { type: "text", text: "Corner pharmacy" },
    });

    server.on("POST", submitUrl, jsonReply(200, { receipt }));
    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" })).toBeInTheDocument();
    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    expect(screen.getByText("Patient Intake · version 1")).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.tagName === "TIME")).toHaveAttribute("datetime", receipt.submittedAt);
    expect(server.sent("POST", submitUrl)[0]?.body).toEqual({ answers: storedAnswersBeforeSubmit() });
    expect(localStorage.getItem(partialsKey(INTAKE_QUESTIONNAIRE_ID))).not.toContain("Corner pharmacy");
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
  });

  it("hides the branch again on no, keeps its answers in storage and submits only the visible items", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerYesBranch(user);

    await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));

    expect(screen.queryByRole("radiogroup", { name: /Which condition\?/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("When were you diagnosed?", { exact: false })).not.toBeInTheDocument();
    expect(storedAnswers()).toMatchObject({
      itm_02: { type: "single_choice", optionId: "opt_diabetes" },
      itm_03: { type: "date", date: "2019-04-02" },
    });

    server.on("POST", submitUrl, jsonReply(200, { receipt }));
    await user.click(submitButton());
    await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" });

    expect(server.sent("POST", submitUrl)[0]?.body).toEqual({
      answers: {
        itm_01: { type: "single_choice", optionId: "no" },
        itm_04: { type: "text", text: "Corner pharmacy" },
      },
    });
  });

  it("disables submit while the request is in flight and sends it once", async () => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
    await user.type(pharmacy(), "Corner pharmacy");
    const held = heldReply();
    server.on("POST", submitUrl, held.reply);

    await user.click(submitButton());

    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(submitButton()).toHaveTextContent("Submitting…");
    await user.click(submitButton());
    fireEvent.submit(screen.getByRole("form", { name: "Patient Intake" }));
    await held.release(jsonReply(200, { receipt }));

    expect(await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" })).toBeInTheDocument();
    expect(server.sent("POST", submitUrl)).toHaveLength(1);
  });

  it("blocks a future diagnosis date and missing answers on the browser's date before any request", async () => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(within(hasCondition()).getByRole("radio", { name: "Yes" }));
    await user.click(within(whichCondition()).getByRole("radio", { name: "Diabetes" }));
    fireEvent.change(diagnosedOn(), { target: { value: "2999-01-01" } });

    await user.click(submitButton());

    expect(await screen.findByText("Enter a date that is not in the future.")).toBeInTheDocument();
    expect(diagnosedOn()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Answer this question.")).toBeInTheDocument();
    expect(server.sent("POST", submitUrl)).toHaveLength(0);

    fireEvent.change(diagnosedOn(), { target: { value: "2019-04-02" } });
    expect(screen.queryByText("Enter a date that is not in the future.")).not.toBeInTheDocument();
  });

  it.each([
    ["a network failure", networkFailure()],
    ["an unexpected response", jsonReply(500, "oops")],
  ])("keeps the form and its stored answers after %s on submit", async (_case, reply) => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
    await user.type(pharmacy(), ANSWER_SENTINEL);
    server.on("POST", submitUrl, reply);

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Your answers were not submitted.");
    expect(screen.getByRole("alert")).not.toHaveTextContent(ANSWER_SENTINEL);
    expect(pharmacy()).toHaveValue(ANSWER_SENTINEL);
    expect(storedAnswers()).toMatchObject({ itm_04: { type: "text", text: ANSWER_SENTINEL } });
    expect(submitButton()).toBeEnabled();
  });

  it("shows the closed screen when submit meets 409 questionnaire/closed, leaving the answers stored", async () => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
    await user.type(pharmacy(), "Corner pharmacy");
    server.on("POST", submitUrl, problemReply(problem("questionnaire/closed")));

    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "This questionnaire is closed" })).toBeInTheDocument();
    expect(storedAnswers()).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });
  });
});

function submissionInvalid(...items: ItemError<SubmissionItemCode>[]) {
  return problemReply(problem("submission/invalid", { items }));
}

function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

async function answerNoBranch(user: ReturnType<typeof userEvent.setup>, pharmacyText = "Corner pharmacy") {
  await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
  await user.type(pharmacy(), pharmacyText);
}

describe("a submission the server rejects with 422 submission/invalid", () => {
  it("returns to the form with an error summary, inline errors and focus on the first invalid item", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerYesBranch(user);
    server.on("POST", submitUrl, submissionInvalid({ itemId: "itm_04", code: "text/too-long" }, { itemId: "itm_03", code: "date/in-future" }));

    await user.click(submitButton());

    const summary = await screen.findByRole("region", { name: "2 answers need attention" });
    expect(within(summary).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "When were you diagnosed? — Enter a date that is not in the future.",
      "Preferred pharmacy — Enter no more than 120 characters.",
    ]);
    expect(diagnosedOn()).toHaveAttribute("aria-invalid", "true");
    expect(pharmacy()).toHaveAttribute("aria-invalid", "true");
    expect(pharmacy()).toHaveAccessibleDescription("Enter no more than 120 characters.");
    await waitFor(() => expect(diagnosedOn()).toHaveFocus());
    expect(screen.getByText("Your answers were not submitted. 2 answers need attention.")).toHaveAttribute("role", "status");
    expect(pharmacy()).toHaveValue("Corner pharmacy");
    expect(storedAnswers()).toEqual(storedAnswersBeforeSubmit());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("jumps to an item from the summary, including a choice group", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerYesBranch(user);
    server.on("POST", submitUrl, submissionInvalid({ itemId: "itm_02", code: "choice/unknown-option" }, { itemId: "itm_04", code: "text/too-long" }));
    await user.click(submitButton());
    const summary = await screen.findByRole("region", { name: "2 answers need attention" });
    await waitFor(() => expect(whichCondition()).toContainElement(activeElement()));

    await user.click(within(summary).getByRole("button", { name: "Preferred pharmacy" }));
    expect(pharmacy()).toHaveFocus();

    await user.click(within(summary).getByRole("button", { name: "Which condition?" }));
    expect(whichCondition()).toContainElement(activeElement());
  });

  it("clears an item's server error when its answer changes, leaving the others", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerYesBranch(user);
    server.on("POST", submitUrl, submissionInvalid({ itemId: "itm_03", code: "date/in-future" }, { itemId: "itm_04", code: "text/too-long" }));
    await user.click(submitButton());
    await screen.findByRole("region", { name: "2 answers need attention" });

    await user.type(pharmacy(), "!");

    expect(pharmacy()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Enter no more than 120 characters.")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "1 answer needs attention" })).toBeInTheDocument();
    expect(diagnosedOn()).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(diagnosedOn(), { target: { value: "2018-01-01" } });
    expect(screen.queryByRole("region", { name: /attention/ })).not.toBeInTheDocument();
  });

  it("submits again once the respondent corrects the answer and shows the receipt", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, submissionInvalid({ itemId: "itm_04", code: "text/too-long" }), jsonReply(200, { receipt }));
    await user.click(submitButton());
    await screen.findByRole("region", { name: "1 answer needs attention" });

    await user.clear(pharmacy());
    await user.type(pharmacy(), "Boots");
    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" })).toBeInTheDocument();
    expect(server.sent("POST", submitUrl)).toHaveLength(2);
  });

  it.each<[string, ItemError<SubmissionItemCode>[]]>([
    ["only codes the grouping drops", [{ itemId: "itm_02", code: "answer/not-visible" }, { itemId: "itm_99", code: "answer/unknown-item" }]],
    ["an item the form is not showing", [{ itemId: "itm_03", code: "answer/required" }]],
    ["no items at all", []],
  ])("shows a generic message and focuses the summary for %s", async (_case, items) => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user, ANSWER_SENTINEL);
    server.on("POST", submitUrl, submissionInvalid(...items));

    await user.click(submitButton());

    const summary = await screen.findByRole("region", { name: "Your answers could not be submitted" });
    expect(summary).toHaveAccessibleDescription("Some answers could not be accepted. Check your answers and submit again.");
    expect(within(summary).queryByRole("listitem")).not.toBeInTheDocument();
    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).not.toHaveTextContent(ANSWER_SENTINEL);
    expect(pharmacy()).toHaveValue(ANSWER_SENTINEL);
    expect(submitButton()).toBeEnabled();
  });

  it("keeps the generic line beside the items it could place", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, submissionInvalid({ itemId: "itm_04", code: "text/too-long" }, { itemId: "itm_02", code: "answer/not-visible" }));

    await user.click(submitButton());

    const summary = await screen.findByRole("region", { name: "1 answer needs attention" });
    expect(within(summary).getAllByRole("listitem")).toHaveLength(1);
    expect(summary).toHaveTextContent("Some answers could not be accepted.");
    await waitFor(() => expect(pharmacy()).toHaveFocus());
  });
});

describe("the client pre-check", () => {
  it("uses the same error summary, focuses the first invalid item and jumps from the summary", async () => {
    const user = userEvent.setup();
    await startFresh();

    await user.click(submitButton());

    const summary = await screen.findByRole("region", { name: "2 answers need attention" });
    expect(within(summary).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "Do you have a medical condition? — Answer this question.",
      "Preferred pharmacy — Answer this question.",
    ]);
    await waitFor(() => expect(hasCondition()).toContainElement(activeElement()));
    expect(screen.getByText("Your answers were not submitted. 2 answers need attention.")).toHaveAttribute("role", "status");
    expect(server.sent("POST", submitUrl)).toHaveLength(0);

    await user.click(within(summary).getByRole("button", { name: "Preferred pharmacy" }));
    expect(pharmacy()).toHaveFocus();
  });
});

describe("a submission meeting 409 session/already-submitted", () => {
  it("fetches the session and shows the recorded receipt with a note, clearing the answers but keeping the ids", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    const heldSession = heldReply();
    server.on("POST", submitUrl, problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, heldSession.reply);

    await user.click(submitButton());
    await waitFor(() => expect(server.sent("GET", sessionUrl)).toHaveLength(1));
    expect(submitButton()).toBeDisabled();
    await heldSession.release(jsonReply(200, { session: submittedSession, definition: intakeV1 }));

    expect(await screen.findByRole("heading", { level: 1, name: "This form was already submitted" })).toBeInTheDocument();
    expect(screen.getByText(/the answers you just sent were not recorded/)).toBeInTheDocument();
    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.tagName === "TIME")).toHaveAttribute("datetime", submittedSession.submittedAt);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
    expect(server.sent("POST", submitUrl)).toHaveLength(1);
  });

  it.each([
    ["a network failure", networkFailure()],
    ["an in-progress session", jsonReply(200, { session: inProgressSession, definition: intakeV1 })],
    ["an internal problem", problemReply(problem("internal", { detail: "correlation" }))],
  ])("offers a focused retry when the session fetch meets %s, keeping the stored answers until the receipt arrives", async (_case, reply) => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    const heldSession = heldReply();
    server.on("POST", submitUrl, problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, reply, heldSession.reply);

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("The submission on record could not be loaded.");
    expect(screen.getByRole("heading", { level: 1, name: "This form was already submitted" })).toBeInTheDocument();
    await waitFor(() => expect(tryAgain()).toHaveFocus());
    expect(storedAnswers()).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });

    await user.click(tryAgain());
    expect(tryAgain()).toHaveAttribute("aria-disabled", "true");
    await user.click(tryAgain());
    await heldSession.release(jsonReply(200, { session: submittedSession, definition: intakeV1 }));

    expect(await screen.findByText(/the answers you just sent were not recorded/)).toBeInTheDocument();
    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
    expect(server.sent("GET", sessionUrl)).toHaveLength(2);
    expect(server.sent("POST", submitUrl)).toHaveLength(1);
  });

  it("shows the generic error screen with no retry when the session fetch meets a problem repeating it cannot fix", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, problemReply(problem("resource/not-found")));

    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(storedAnswers()).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });
  });
});

describe("resuming from storage", () => {
  it("resumes an in-progress session with its answers and the restore strip, without starting another", async () => {
    storeSession(SESSION_ID, {
      itm_01: { type: "single_choice", optionId: "no" },
      itm_03: { type: "date", date: "2019-04-02" },
      itm_04: { type: "text", text: "Corner pharmacy" },
    });
    server.on("GET", sessionUrl, jsonReply(200, { session: inProgressSession, definition: intakeV1 }));
    renderApp();

    expect(await screen.findByText("We restored the answers you started on this device.")).toBeInTheDocument();
    expect(within(hasCondition()).getByRole("radio", { name: "No" })).toBeChecked();
    expect(pharmacy()).toHaveValue("Corner pharmacy");
    expect(screen.queryByRole("button", { name: /Start over/ })).not.toBeInTheDocument();
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);

    const user = userEvent.setup();
    await user.click(within(hasCondition()).getByRole("radio", { name: "Yes" }));
    expect(diagnosedOn()).toHaveValue("2019-04-02");
  });

  it("resumes a stored session with no answers yet without the restore strip", async () => {
    storeSession(SESSION_ID, {});
    server.on("GET", sessionUrl, jsonReply(200, { session: inProgressSession, definition: intakeV1 }));
    renderApp();

    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
    expect(screen.queryByText(/We restored the answers/)).not.toBeInTheDocument();
  });

  it("shows the receipt for a submitted session and clears any answers still stored", async () => {
    storeSession(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    server.on("GET", sessionUrl, jsonReply(200, { session: submittedSession, definition: intakeV1 }));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" })).toBeInTheDocument();
    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, answers: {} });
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
  });

  it("removes a stale session on 404 and starts a new one", async () => {
    storeSession(STALE_SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    server.on("GET", `/api/run/sessions/${STALE_SESSION_ID}`, problemReply(problem("resource/not-found")));
    server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    renderApp();

    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
    expect(pharmacy()).toHaveValue("");
    expect(screen.queryByText(/We restored the answers/)).not.toBeInTheDocument();
    expect(server.sent("POST", sessionsUrl)).toHaveLength(1);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, answers: {} });
  });

  it("shows the closed screen when resume meets 409 questionnaire/closed", async () => {
    storeSession(SESSION_ID, {});
    server.on("GET", sessionUrl, problemReply(problem("questionnaire/closed")));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "This questionnaire is closed" })).toBeInTheDocument();
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
  });

});

const transientFailures = [
  ["a network failure", networkFailure],
  ["a 503 proxy page", () => jsonReply(503, "<html>Service unavailable</html>")],
  ["an internal problem", () => problemReply(problem("internal", { detail: "correlation" }))],
] as const;

describe("retrying a start that failed", () => {
  it.each(transientFailures)("offers a retry after %s, sends one request per click and opens the form on success", async (_case, failure) => {
    const user = userEvent.setup();
    const held = heldReply();
    server.on("POST", sessionsUrl, failure(), held.reply);
    renderApp();

    expect(await screen.findByRole("heading", loadFailedHeading)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The connection may have dropped, or the service may be briefly unavailable.");
    expect(tryAgain()).toHaveAccessibleDescription(/The connection may have dropped/);
    expect(tryAgain()).not.toHaveFocus();
    expect(screen.queryByRole("button", { name: /Start a new session/ })).not.toBeInTheDocument();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();

    await user.click(tryAgain());
    expect(tryAgain()).toHaveTextContent("Trying again…");
    expect(tryAgain()).toHaveAttribute("aria-disabled", "true");
    await user.click(tryAgain());
    await user.keyboard("{Enter}");
    await held.release(jsonReply(201, { session: inProgressSession, definition: intakeV1 }));

    expect(await screen.findByRole("heading", { level: 1, name: "Patient Intake" })).toBeInTheDocument();
    expect(server.sent("POST", sessionsUrl)).toHaveLength(2);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
  });

  it("stays on the failure screen when the retry fails too, announcing it again and focusing Try again", async () => {
    const user = userEvent.setup();
    server.on("POST", sessionsUrl, networkFailure(), networkFailure());
    renderApp();
    const firstAlert = await screen.findByRole("alert");

    await user.click(tryAgain());

    await waitFor(() => expect(tryAgain()).toHaveFocus());
    expect(tryAgain()).toHaveTextContent("Try again");
    expect(tryAgain()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("alert")).not.toBe(firstAlert);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(2);
  });
});

describe("retrying a resume that failed", () => {
  it.each(transientFailures)("offers a retry after %s without starting a session, and restores the answers on success", async (_case, failure) => {
    const user = userEvent.setup();
    const saved: ClientAnswers = { itm_01: { type: "single_choice", optionId: "no" }, itm_04: { type: "text", text: "Corner pharmacy" } };
    storeSession(SESSION_ID, saved);
    server.on("GET", sessionUrl, failure(), jsonReply(200, { session: inProgressSession, definition: intakeV1 }));
    renderApp();

    expect(await screen.findByRole("heading", loadFailedHeading)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The answers you started are still saved on this device.");
    expect(storedAnswers()).toEqual(saved);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);

    await user.click(tryAgain());

    expect(await screen.findByText("We restored the answers you started on this device.")).toBeInTheDocument();
    expect(pharmacy()).toHaveValue("Corner pharmacy");
    expect(server.sent("GET", sessionUrl)).toHaveLength(2);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
    expect(storedAnswers()).toEqual(saved);
  });

  it("does not claim saved answers when the stored session holds none", async () => {
    storeSession(SESSION_ID, {});
    server.on("GET", sessionUrl, networkFailure());
    renderApp();

    expect(await screen.findByRole("alert")).not.toHaveTextContent("still saved");
    expect(tryAgain()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start a new session/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/start a new session/i)).not.toBeInTheDocument();
  });

  it("offers Try again and Start a new session when the stored session holds answers", async () => {
    storeSession(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    server.on("GET", sessionUrl, networkFailure());
    renderApp();

    expect(await screen.findByRole("alert")).toHaveTextContent("The answers you started are still saved on this device.");
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Try again", "Start a new session"]);
  });

  it("starts a new session from a failed resume, replacing the stored id only on 201 and carrying the answers into it", async () => {
    const user = userEvent.setup();
    const saved: ClientAnswers = { itm_01: { type: "single_choice", optionId: "no" }, itm_04: { type: "text", text: "Corner pharmacy" } };
    const abandonedUrl = `/api/run/sessions/${STALE_SESSION_ID}`;
    storeSession(STALE_SESSION_ID, saved);
    const held = heldReply();
    server.on("GET", abandonedUrl, networkFailure());
    server.on("POST", sessionsUrl, held.reply);
    renderApp();
    await screen.findByRole("heading", loadFailedHeading);
    expect(startNewSession()).toHaveAccessibleDescription(
      "If this keeps happening, start a new session. Your answers so far are kept and carried into it.",
    );

    await user.click(startNewSession());
    expect(startNewSession()).toHaveTextContent("Starting a new session…");
    expect(startNewSession()).toHaveAttribute("aria-disabled", "true");
    expect(tryAgain()).toHaveAttribute("aria-disabled", "true");
    expect(startNewSession()).toHaveFocus();
    await user.click(startNewSession());
    await user.click(tryAgain());
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: STALE_SESSION_ID, answers: saved });
    await held.release(jsonReply(201, { session: inProgressSession, definition: intakeV1 }));

    expect(await screen.findByText("We restored the answers you started on this device.")).toBeInTheDocument();
    expect(within(hasCondition()).getByRole("radio", { name: "No" })).toBeChecked();
    expect(pharmacy()).toHaveValue("Corner pharmacy");
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: saved });
    expect(server.sent("GET", abandonedUrl)).toHaveLength(1);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(1);
  });

  it("lands on the start failure screen with its own retry when the new session cannot start, still carrying the answers", async () => {
    const user = userEvent.setup();
    const saved: ClientAnswers = { itm_04: { type: "text", text: "Corner pharmacy" } };
    storeSession(STALE_SESSION_ID, saved);
    server.on("GET", `/api/run/sessions/${STALE_SESSION_ID}`, networkFailure());
    server.on("POST", sessionsUrl, jsonReply(503, "<html>Service unavailable</html>"), jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    renderApp();
    await screen.findByRole("heading", loadFailedHeading);

    await user.click(startNewSession());

    await waitFor(() => expect(screen.queryByRole("button", { name: /Start a new session/ })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", loadFailedHeading)).toBeInTheDocument();
    await waitFor(() => expect(tryAgain()).toHaveFocus());
    expect(screen.getByRole("alert")).not.toHaveTextContent("still saved");
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: STALE_SESSION_ID, answers: saved });

    await user.click(tryAgain());

    expect(await screen.findByText("We restored the answers you started on this device.")).toBeInTheDocument();
    expect(pharmacy()).toHaveValue("Corner pharmacy");
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, answers: saved });
    expect(server.sent("POST", sessionsUrl)).toHaveLength(2);
  });

  it("blocks Start a new session while Try again is in flight", async () => {
    const user = userEvent.setup();
    storeSession(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    server.on("GET", sessionUrl, networkFailure(), heldReply().reply);
    renderApp();
    await screen.findByRole("heading", loadFailedHeading);

    await user.click(tryAgain());
    expect(startNewSession()).toHaveAttribute("aria-disabled", "true");
    await user.click(startNewSession());

    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
  });

  it("starts a new session when the retried resume finds the stored session stale", async () => {
    const user = userEvent.setup();
    storeSession(STALE_SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    const staleUrl = `/api/run/sessions/${STALE_SESSION_ID}`;
    server.on("GET", staleUrl, networkFailure(), problemReply(problem("resource/not-found")));
    server.on("POST", sessionsUrl, networkFailure(), jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    renderApp();
    await screen.findByRole("heading", loadFailedHeading);

    await user.click(tryAgain());
    await waitFor(() => expect(tryAgain()).toHaveFocus());
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
    await user.click(tryAgain());

    expect(await screen.findByRole("heading", { level: 1, name: "Patient Intake" })).toBeInTheDocument();
    expect(server.sent("GET", staleUrl)).toHaveLength(2);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(2);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, answers: {} });
  });
});

describe("retrying a submit that failed", () => {
  it.each(transientFailures)(
    "keeps the form with a focused Try again after %s, resends the same visible answers once, and clears them only on 200",
    async (_case, failure) => {
      const user = userEvent.setup();
      await startFresh();
      await answerYesBranch(user);
      await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
      const held = heldReply();
      server.on("POST", submitUrl, failure(), held.reply);

      await user.click(submitButton());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Your answers were not submitted.");
      expect(alert).toHaveTextContent("They are still saved on this device. The connection may have dropped");
      await waitFor(() => expect(tryAgain()).toHaveFocus());
      expect(tryAgain()).toHaveAccessibleDescription(/Your answers were not submitted/);
      expect(pharmacy()).toHaveValue("Corner pharmacy");
      expect(storedAnswers()).toEqual({ ...storedAnswersBeforeSubmit(), itm_01: { type: "single_choice", optionId: "no" } });
      expect(submitButton()).toBeEnabled();

      await user.click(tryAgain());
      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(submitButton()).toHaveTextContent("Submitting…");
      expect(tryAgain()).toHaveTextContent("Trying again…");
      expect(tryAgain()).toHaveAttribute("aria-disabled", "true");
      expect(tryAgain()).toHaveFocus();
      await user.click(tryAgain());
      await user.click(submitButton());
      fireEvent.submit(screen.getByRole("form", { name: "Patient Intake" }));
      expect(storedAnswers()).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });
      await held.release(jsonReply(200, { receipt }));

      expect(await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" })).toBeInTheDocument();
      const [first, retried, ...more] = server.sent("POST", submitUrl);
      expect(more).toHaveLength(0);
      expect(retried?.body).toEqual(first?.body);
      expect(retried?.body).toEqual({ answers: { itm_01: { type: "single_choice", optionId: "no" }, itm_04: { type: "text", text: "Corner pharmacy" } } });
      expect(localStorage.getItem(partialsKey(INTAKE_QUESTIONNAIRE_ID))).not.toContain("Corner pharmacy");
      expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
    },
  );

  it("announces a failed retry again and returns focus to Try again, with the answers still stored", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user, ANSWER_SENTINEL);
    server.on("POST", submitUrl, networkFailure(), jsonReply(502, "<html>Bad gateway</html>"));
    await user.click(submitButton());
    const firstAlert = await screen.findByRole("alert");

    await user.click(tryAgain());

    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(firstAlert));
    await waitFor(() => expect(tryAgain()).toHaveFocus());
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).not.toHaveTextContent(ANSWER_SENTINEL);
    expect(tryAgain()).not.toHaveAttribute("aria-disabled");
    expect(pharmacy()).toHaveValue(ANSWER_SENTINEL);
    expect(storedAnswers()).toMatchObject({ itm_04: { type: "text", text: ANSWER_SENTINEL } });
    expect(server.sent("POST", submitUrl)).toHaveLength(2);
  });

  it("retries with the answers as they are now when the respondent edits one after the failure", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, networkFailure(), jsonReply(200, { receipt }));
    await user.click(submitButton());
    await screen.findByRole("alert");

    await user.clear(pharmacy());
    await user.type(pharmacy(), "Boots");
    await user.click(tryAgain());

    await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" });
    expect(server.sent("POST", submitUrl)[1]?.body).toEqual({
      answers: { itm_01: { type: "single_choice", optionId: "no" }, itm_04: { type: "text", text: "Boots" } },
    });
  });

  it("lands on the recorded receipt with its note when the retry meets 409 session/already-submitted", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, networkFailure(), problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, jsonReply(200, { session: submittedSession, definition: intakeV1 }));
    await user.click(submitButton());
    await screen.findByRole("alert");

    await user.click(tryAgain());

    expect(await screen.findByRole("heading", { level: 1, name: "This form was already submitted" })).toBeInTheDocument();
    expect(screen.getByText(/the answers you just sent were not recorded/)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.tagName === "TIME")).toHaveAttribute("datetime", submittedSession.submittedAt);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
    expect(server.sent("POST", submitUrl)).toHaveLength(2);
  });

  it("returns to the error summary without the failure alert when the retry meets a 422", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, networkFailure(), submissionInvalid({ itemId: "itm_04", code: "text/too-long" }));
    await user.click(submitButton());
    await screen.findByRole("alert");

    await user.click(tryAgain());

    expect(await screen.findByRole("region", { name: "1 answer needs attention" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(pharmacy()).toHaveFocus());
  });

  it("offers no Try again for a submit problem that repeating cannot fix, leaving Submit enabled", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, problemReply(problem("resource/not-found")));

    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your answers were not submitted.");
    expect(alert).toHaveTextContent("They are still saved on this device.");
    expect(alert).not.toHaveTextContent("connection");
    expect(screen.queryByRole("button", { name: /Try again/ })).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(storedAnswers()).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });
  });
});

describe("accessibility", () => {
  it("finds no axe violations on the form with the branch revealed", async () => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(within(hasCondition()).getByRole("radio", { name: "Yes" }));

    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the resumed form with the restore strip", async () => {
    storeSession(SESSION_ID, { itm_01: { type: "single_choice", optionId: "no" } });
    server.on("GET", sessionUrl, jsonReply(200, { session: inProgressSession, definition: intakeV1 }));
    renderApp();
    await screen.findByText("We restored the answers you started on this device.");

    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the form with pre-check errors and after a failed submit", async () => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(submitButton());
    await screen.findAllByText("Answer this question.");
    expect(await axeViolations()).toEqual([]);

    await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
    await user.type(pharmacy(), "Corner pharmacy");
    server.on("POST", submitUrl, networkFailure());
    await user.click(submitButton());
    await screen.findByRole("alert");
    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the error summary after a 422 with placed and generic errors", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, submissionInvalid({ itemId: "itm_04", code: "text/too-long" }, { itemId: "itm_02", code: "answer/not-visible" }));
    await user.click(submitButton());
    await screen.findByRole("region", { name: "1 answer needs attention" });

    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the already-submitted receipt", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, jsonReply(200, { session: submittedSession, definition: intakeV1 }));
    await user.click(submitButton());
    await screen.findByRole("heading", { level: 1, name: "This form was already submitted" });

    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the resume failure screen and while its retry is in flight", async () => {
    const user = userEvent.setup();
    storeSession(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    server.on("GET", sessionUrl, networkFailure(), heldReply().reply);
    renderApp();
    await screen.findByRole("heading", loadFailedHeading);
    expect(await axeViolations()).toEqual([]);

    await user.click(tryAgain());
    expect(tryAgain()).toHaveAttribute("aria-disabled", "true");
    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the submit failure alert while its retry is in flight", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, networkFailure(), heldReply().reply);
    await user.click(submitButton());
    await screen.findByRole("alert");

    await user.click(tryAgain());
    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the recorded-receipt failure screen", async () => {
    const user = userEvent.setup();
    await startFresh();
    await answerNoBranch(user);
    server.on("POST", submitUrl, problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, networkFailure());
    await user.click(submitButton());
    await screen.findByText("The submission on record could not be loaded.", { exact: false });

    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations while loading", async () => {
    server.on("POST", sessionsUrl, heldReply().reply);
    renderApp();

    expect(screen.getByRole("status")).toHaveTextContent("Loading questionnaire…");
    expect(await axeViolations()).toEqual([]);
  });

  it("finds no axe violations on the receipt", async () => {
    storeSession(SESSION_ID, {});
    server.on("GET", sessionUrl, jsonReply(200, { session: submittedSession, definition: intakeV1 }));
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" });

    expect(await axeViolations()).toEqual([]);
  });

  it.each([
    ["closed", problemReply(problem("questionnaire/closed")), "This questionnaire is closed"],
    ["not-found", problemReply(problem("resource/not-found")), "Questionnaire not found"],
    ["generic error", problemReply(problem("request/invalid", { errors: [] })), "Something went wrong"],
    ["load failure", networkFailure(), "The questionnaire could not be loaded"],
  ])("finds no axe violations on the %s screen", async (_screen, reply, heading) => {
    server.on("POST", sessionsUrl, reply);
    renderApp();
    await screen.findByRole("heading", { level: 1, name: heading });

    expect(await axeViolations()).toEqual([]);
  });
});

function storedAnswersBeforeSubmit(): ClientAnswers {
  return {
    itm_01: { type: "single_choice", optionId: "yes" },
    itm_02: { type: "single_choice", optionId: "opt_diabetes" },
    itm_03: { type: "date", date: "2019-04-02" },
    itm_04: { type: "text", text: "Corner pharmacy" },
  };
}
