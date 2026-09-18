import { executionApi, problem, type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { axeViolations, FakeServer, heldReply, jsonReply, networkFailure, problemReply, urlOf } from "@qp/ui/testing";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app.tsx";
import { readPartials, writePartials } from "../../src/storage/partials.ts";
import { inProgressSession, intakeV1, SESSION_ID, submittedSession } from "../fixtures.ts";

const intakePath = `/q/${INTAKE_QUESTIONNAIRE_ID}`;
const sessionsUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.createSession);
const sessionUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.getSession, { params: { sessionId: SESSION_ID } });
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

const hasCondition = () => screen.getByRole("radiogroup", { name: /Do you have a medical condition\?/ });
const pharmacy = () => screen.getByLabelText("Preferred pharmacy", { exact: false });
const submitButton = () => screen.getByRole("button", { name: /Submit/ });
const tryAgain = () => screen.getByRole("button", { name: /^(Try again|Trying again…)$/ });

async function submitFromFreshForm(user: ReturnType<typeof userEvent.setup>) {
  server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
  renderApp();
  await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
  await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
  await user.type(pharmacy(), "Corner pharmacy");
}

describe("resuming a submitted session", () => {
  it("shows its receipt without POST and clears any answers still stored", async () => {
    storeSession(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    server.on("GET", sessionUrl, jsonReply(200, { session: submittedSession, definition: intakeV1 }));
    renderApp();

    expect(await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" })).toBeInTheDocument();
    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, answers: {} });
    expect(server.sent("POST", sessionsUrl)).toHaveLength(0);
    expect(await axeViolations()).toEqual([]);
  });
});

describe("a submission meeting 409 session/already-submitted", () => {
  it("fetches the session and shows the recorded receipt with a note, clearing the answers but keeping the ids", async () => {
    const user = userEvent.setup();
    await submitFromFreshForm(user);
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
    expect(await axeViolations()).toEqual([]);
  });

  it.each([
    ["a network failure", networkFailure()],
    ["an in-progress session", jsonReply(200, { session: inProgressSession, definition: intakeV1 })],
    ["an internal problem", problemReply(problem("internal", { detail: "correlation" }))],
  ] as const)("offers a focused retry when the session fetch meets %s, keeping the stored answers until the receipt arrives", async (caseName, reply) => {
    const user = userEvent.setup();
    await submitFromFreshForm(user);
    const heldSession = heldReply();
    server.on("POST", submitUrl, problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, reply, heldSession.reply);

    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("The submission on record could not be loaded.");
    expect(screen.getByRole("heading", { level: 1, name: "This form was already submitted" })).toBeInTheDocument();
    await waitFor(() => expect(tryAgain()).toHaveFocus());
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)?.answers).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });
    if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);

    await user.click(tryAgain());
    expect(tryAgain()).toHaveAttribute("aria-disabled", "true");
    if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);
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
    await submitFromFreshForm(user);
    server.on("POST", submitUrl, problemReply(problem("session/already-submitted")));
    server.on("GET", sessionUrl, problemReply(problem("resource/not-found")));

    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)?.answers).toMatchObject({ itm_04: { type: "text", text: "Corner pharmacy" } });
  });
});
