import { executionApi, problem, type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { axeViolations, FakeServer, heldReply, jsonReply, networkFailure, problemReply, urlOf } from "@qp/ui/testing";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app.tsx";
import { readPartials, writePartials } from "../../src/storage/partials.ts";
import { inProgressSession, intakeV1, SESSION_ID, STALE_SESSION_ID } from "../fixtures.ts";

const intakePath = `/q/${INTAKE_QUESTIONNAIRE_ID}`;
const sessionsUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.createSession);
const sessionUrlOf = (sessionId: string) => urlOf(executionApi.EXECUTION_PREFIX, executionApi.getSession, { params: { sessionId } });
const sessionUrl = sessionUrlOf(SESSION_ID);
const submitUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.submitSession, { params: { sessionId: SESSION_ID } });

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer().install();
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

const loadFailedHeading = { level: 1, name: "The questionnaire could not be loaded" } as const;
const hasCondition = () => screen.getByRole("radiogroup", { name: /Do you have a medical condition\?/ });
const pharmacy = () => screen.getByLabelText("Preferred pharmacy", { exact: false });
const submitButton = () => screen.getByRole("button", { name: /Submit/ });
const tryAgain = () => screen.getByRole("button", { name: /^(Try again|Trying again…)$/ });
const startNewSession = () => screen.getByRole("button", { name: /^(Start a new session|Starting a new session…)$/ });

const transientFailures = [
  ["a network failure", networkFailure],
  ["a 503 proxy page", () => jsonReply(503, "<html>Service unavailable</html>")],
  ["an internal problem", () => problemReply(problem("internal", { detail: "correlation" }))],
] as const;

describe("the loading screen", () => {
  it("shows a loading status and finds no axe violations", async () => {
    server.on("POST", sessionsUrl, heldReply().reply);
    renderApp();

    expect(screen.getByRole("status")).toHaveTextContent("Loading questionnaire…");
    expect(await axeViolations()).toEqual([]);
  });
});

describe("the closed screen", () => {
  it("shows on 409 questionnaire/closed when starting", async () => {
    server.on("POST", sessionsUrl, problemReply(problem("questionnaire/closed")));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "This questionnaire is closed" })).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });

  it("shows on 409 questionnaire/closed when resuming, without starting a session", async () => {
    storeSession(SESSION_ID, {});
    server.on("GET", sessionUrl, problemReply(problem("questionnaire/closed")));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "This questionnaire is closed" })).toBeInTheDocument();
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
  });

  it("shows on 409 questionnaire/closed when submitting, leaving the answers stored", async () => {
    const user = userEvent.setup();
    server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
    await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
    await user.type(pharmacy(), "Corner pharmacy");
    server.on("POST", submitUrl, problemReply(problem("questionnaire/closed")));

    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "This questionnaire is closed" })).toBeInTheDocument();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)?.answers).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });
  });
});

describe("the not-found screen", () => {
  it("shows on 404 when starting", async () => {
    server.on("POST", sessionsUrl, problemReply(problem("resource/not-found")));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Questionnaire not found" })).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });
});

describe("the generic error screen", () => {
  it("shows with no retry on a problem repeating the request cannot fix", async () => {
    server.on("POST", sessionsUrl, problemReply(problem("request/invalid", { errors: [] })));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });
});

describe("retrying a start that failed", () => {
  it.each(transientFailures)("offers a retry after %s, sends one request per click and opens the form on success", async (caseName, failure) => {
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
    if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);

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
  it.each(transientFailures)("offers a retry after %s without starting a session, and restores the answers on success", async (caseName, failure) => {
    const user = userEvent.setup();
    const saved: ClientAnswers = { itm_01: { type: "single_choice", optionId: "no" }, itm_04: { type: "text", text: "Corner pharmacy" } };
    storeSession(SESSION_ID, saved);
    server.on("GET", sessionUrl, failure(), jsonReply(200, { session: inProgressSession, definition: intakeV1 }));
    renderApp();

    expect(await screen.findByRole("heading", loadFailedHeading)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The answers you started are still saved on this device.");
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)?.answers).toEqual(saved);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
    if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);

    await user.click(tryAgain());
    if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);

    expect(await screen.findByText("We restored the answers you started on this device.")).toBeInTheDocument();
    expect(screen.getByLabelText("Preferred pharmacy", { exact: false })).toHaveValue("Corner pharmacy");
    expect(server.sent("GET", sessionUrl)).toHaveLength(2);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)?.answers).toEqual(saved);
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
    const abandonedUrl = sessionUrlOf(STALE_SESSION_ID);
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
    expect(screen.getByLabelText("Preferred pharmacy", { exact: false })).toHaveValue("Corner pharmacy");
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: saved });
    expect(server.sent("GET", abandonedUrl)).toHaveLength(1);
    expect(server.sent("POST", sessionsUrl)).toHaveLength(1);
  });

  it("lands on the start failure screen with its own retry when the new session cannot start, still carrying the answers", async () => {
    const user = userEvent.setup();
    const saved: ClientAnswers = { itm_04: { type: "text", text: "Corner pharmacy" } };
    storeSession(STALE_SESSION_ID, saved);
    server.on("GET", sessionUrlOf(STALE_SESSION_ID), networkFailure());
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
    expect(screen.getByLabelText("Preferred pharmacy", { exact: false })).toHaveValue("Corner pharmacy");
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
    const staleUrl = sessionUrlOf(STALE_SESSION_ID);
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
