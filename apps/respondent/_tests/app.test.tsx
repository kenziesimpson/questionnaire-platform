import { executionApi, type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { axeViolations, FakeServer, jsonReply, urlOf } from "@qp/ui/testing";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app.tsx";
import { readPartials } from "../src/storage/partials.ts";
import { inProgressSession, intakeV1, receipt, SESSION_ID } from "./fixtures.ts";

const intakePath = `/q/${INTAKE_QUESTIONNAIRE_ID}`;
const sessionsUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.createSession);
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

function group(name: RegExp) {
  return screen.getByRole("radiogroup", { name });
}

const hasCondition = () => group(/Do you have a medical condition\?/);
const whichCondition = () => group(/Which condition\?/);
const diagnosedOn = () => screen.getByLabelText("When were you diagnosed?", { exact: false });
const pharmacy = () => screen.getByLabelText("Preferred pharmacy", { exact: false });
const submitButton = () => screen.getByRole("button", { name: /Submit/ });

describe("entry dispatch", () => {
  it.each(["/", "/q/", "/q/not-a-uuid", `/q/${INTAKE_QUESTIONNAIRE_ID}/extra`, "/q/%E0%A4%A"])(
    "shows the not-found screen for %s without calling the API",
    (pathname) => {
      renderApp(pathname);

      expect(screen.getByRole("heading", { level: 1, name: "Questionnaire not found" })).toBeInTheDocument();
      expect(server.fetch).not.toHaveBeenCalled();
    },
  );
});

describe("the happy path", () => {
  it("starts a session, reveals the branch on yes, submits and shows the receipt", async () => {
    const user = userEvent.setup();
    server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });

    expect(server.sent("POST", sessionsUrl).map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: "POST", url: sessionsUrl, body: { questionnaireId: INTAKE_QUESTIONNAIRE_ID } },
    ]);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
    expect(screen.queryByText(/We restored the answers/)).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await user.click(within(hasCondition()).getByRole("radio", { name: "Yes" }));
    await user.click(within(whichCondition()).getByRole("radio", { name: "Diabetes" }));
    fireEvent.change(diagnosedOn(), { target: { value: "2019-04-02" } });
    await user.type(pharmacy(), "Corner pharmacy");
    const submittedAnswers: ClientAnswers = {
      itm_01: { type: "single_choice", optionId: "yes" },
      itm_02: { type: "single_choice", optionId: "opt_diabetes" },
      itm_03: { type: "date", date: "2019-04-02" },
      itm_04: { type: "text", text: "Corner pharmacy" },
    };
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)?.answers).toEqual(submittedAnswers);
    expect(await axeViolations()).toEqual([]);

    server.on("POST", submitUrl, jsonReply(200, { receipt }));
    await user.click(submitButton());

    expect(await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" })).toBeInTheDocument();
    expect(screen.getByText(SESSION_ID)).toBeInTheDocument();
    expect(screen.getByText("Patient Intake · version 1")).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.tagName === "TIME")).toHaveAttribute("datetime", receipt.submittedAt);
    expect(server.sent("POST", submitUrl)[0]?.body).toEqual({ answers: submittedAnswers });
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toMatchObject({ sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers: {} });
  });
});
