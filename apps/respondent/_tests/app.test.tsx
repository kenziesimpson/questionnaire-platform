import { INTAKE_QUESTIONNAIRE_ID, problem, type ClientAnswers } from "@qp/shared";
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

  it.each([
    ["a network failure", networkFailure()],
    ["an unexpected response", jsonReply(502, "<html>Bad gateway</html>")],
    ["an internal problem", problemReply(problem("internal", { detail: "correlation" }))],
  ])("shows the generic error screen on %s", async (_case, reply) => {
    server.on("POST", sessionsUrl, reply);
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
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
    ["409 session/already-submitted", problemReply(problem("session/already-submitted"))],
    [
      "422 submission/invalid",
      problemReply(problem("submission/invalid", { items: [{ itemId: "itm_04", code: "text/too-long" }] })),
    ],
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

  it("shows the generic error screen and keeps the stored answers when resume fails on the network", async () => {
    storeSession(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    server.on("GET", sessionUrl, networkFailure());
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(storedAnswers()).toEqual({ itm_04: { type: "text", text: "Corner pharmacy" } });
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
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
    ["generic error", networkFailure(), "Something went wrong"],
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
