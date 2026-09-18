import { executionApi, problem, type ClientAnswers, type ItemError, type SubmissionItemCode } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { axeViolations, FakeServer, heldReply, jsonReply, networkFailure, problemReply, urlOf } from "@qp/ui/testing";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app";
import { partialsKey, readPartials, writePartials } from "../../src/storage/partials";
import { ANSWER_SENTINEL, inProgressSession, intakeV1, receipt, SESSION_ID, submittedSession } from "../fixtures";

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

async function answerNoBranch(user: ReturnType<typeof userEvent.setup>, pharmacyText = "Corner pharmacy") {
  await user.click(within(hasCondition()).getByRole("radio", { name: "No" }));
  await user.type(pharmacy(), pharmacyText);
}

function storedAnswersBeforeSubmit(): ClientAnswers {
  return {
    itm_01: { type: "single_choice", optionId: "yes" },
    itm_02: { type: "single_choice", optionId: "opt_diabetes" },
    itm_03: { type: "date", date: "2019-04-02" },
    itm_04: { type: "text", text: "Corner pharmacy" },
  };
}

function submissionInvalid(...items: ItemError<SubmissionItemCode>[]) {
  return problemReply(problem("submission/invalid", { items }));
}

function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

const transientFailures = [
  ["a network failure", networkFailure],
  ["a 503 proxy page", () => jsonReply(503, "<html>Service unavailable</html>")],
  ["an internal problem", () => problemReply(problem("internal", { detail: "correlation" }))],
] as const;

describe("the branch", () => {
  it("hides again on no, keeps its answers in storage and submits only the visible items", async () => {
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
});

describe("submitting", () => {
  it("disables the button while the request is in flight and sends it once", async () => {
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
  ] as const)("keeps the form and its stored answers after %s on submit", async (caseName, reply) => {
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
    if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);
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
    expect(await axeViolations()).toEqual([]);

    await user.click(within(summary).getByRole("button", { name: "Preferred pharmacy" }));
    expect(pharmacy()).toHaveFocus();
  });
});

describe("touched-on-blur error timing", () => {
  it("shows no error before a field is visited, then only that field's error once it is left", async () => {
    await startFresh();

    expect(screen.queryByText("Answer this question.")).not.toBeInTheDocument();
    expect(pharmacy()).not.toHaveAttribute("aria-invalid");
    expect(hasCondition()).not.toHaveAttribute("aria-invalid");

    fireEvent.blur(pharmacy());

    const summary = await screen.findByRole("region", { name: "1 answer needs attention" });
    expect(within(summary).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["Preferred pharmacy — Answer this question."]);
    expect(pharmacy()).toHaveAttribute("aria-invalid", "true");
    expect(hasCondition()).not.toHaveAttribute("aria-invalid", "true");
    expect(server.sent("POST", submitUrl)).toHaveLength(0);
  });

  it("shows every visible item's error once a submit is attempted, not only the ones already visited", async () => {
    const user = userEvent.setup();
    await startFresh();
    fireEvent.blur(pharmacy());
    await screen.findByText("Answer this question.");

    await user.click(submitButton());

    const summary = await screen.findByRole("region", { name: "2 answers need attention" });
    expect(within(summary).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "Do you have a medical condition? — Answer this question.",
      "Preferred pharmacy — Answer this question.",
    ]);
  });

  it("updates a touched field's error live as the answer changes, without needing another blur", async () => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(within(hasCondition()).getByRole("radio", { name: "Yes" }));
    await user.click(within(whichCondition()).getByRole("radio", { name: "Diabetes" }));
    fireEvent.change(diagnosedOn(), { target: { value: "2999-01-01" } });
    fireEvent.blur(diagnosedOn());

    expect(await screen.findByText("Enter a date that is not in the future.")).toBeInTheDocument();

    fireEvent.change(diagnosedOn(), { target: { value: "2019-04-02" } });

    expect(screen.queryByText("Enter a date that is not in the future.")).not.toBeInTheDocument();
  });

  it("moving focus within the same item, such as a radio to its own freeform Other box, does not touch it early", async () => {
    const user = userEvent.setup();
    await startFresh();
    await user.click(within(hasCondition()).getByRole("radio", { name: "Yes" }));
    await user.click(within(whichCondition()).getByRole("radio", { name: "Other" }));
    const otherBox = screen.getByRole("textbox", { name: "Other, please specify" });

    await user.click(otherBox);

    expect(screen.queryByText('Enter your answer for "Other".')).not.toBeInTheDocument();
    expect(whichCondition()).not.toHaveAttribute("aria-invalid", "true");

    await user.tab();

    expect(await screen.findByText('Enter your answer for "Other".')).toBeInTheDocument();
    expect(whichCondition()).toHaveAttribute("aria-invalid", "true");
  });
});

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
    expect(await axeViolations()).toEqual([]);
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
    expect(await axeViolations()).toEqual([]);

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
});

describe("retrying a submit that failed", () => {
  it.each(transientFailures)(
    "keeps the form with a focused Try again after %s, resends the same visible answers once, and clears them only on 200",
    async (caseName, failure) => {
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
      if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);

      await user.click(tryAgain());
      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(submitButton()).toHaveTextContent("Submitting…");
      expect(tryAgain()).toHaveTextContent("Trying again…");
      expect(tryAgain()).toHaveAttribute("aria-disabled", "true");
      expect(tryAgain()).toHaveFocus();
      if (caseName === "a network failure") expect(await axeViolations()).toEqual([]);
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
});
