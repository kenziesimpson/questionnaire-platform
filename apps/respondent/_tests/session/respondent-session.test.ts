import { problem, type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { createSession, getSession, submitSession } from "../../src/api/execution-client.ts";
import { createRespondentSession, type ExecutionClient, type PartialsStorage } from "../../src/session/respondent-session.ts";
import type { clearPartialAnswers, readPartials, removePartials, writePartials } from "../../src/storage/partials.ts";
import { PARTIALS_FORMAT_VERSION, type StoredPartials } from "../../src/storage/partials.ts";
import { inProgressSession, intakeV1, receipt, SESSION_ID, STALE_SESSION_ID, submittedSession } from "../fixtures.ts";

const NOW = "2026-09-14T09:00:00.000Z";

const noBranchAnswers: ClientAnswers = {
  itm_01: { type: "single_choice", optionId: "no" },
  itm_04: { type: "text", text: "Corner pharmacy" },
};

function ok<T>(body: T) {
  return { kind: "ok" as const, body };
}

const networkError = { kind: "network-error" as const };

function unexpectedResponse(status: number) {
  return { kind: "unexpected-response" as const, status };
}

function fakeClient(): ExecutionClient & {
  createSession: Mock<typeof createSession>;
  getSession: Mock<typeof getSession>;
  submitSession: Mock<typeof submitSession>;
} {
  return { createSession: vi.fn<typeof createSession>(), getSession: vi.fn<typeof getSession>(), submitSession: vi.fn<typeof submitSession>() };
}

type FakeClient = ReturnType<typeof fakeClient>;

function fakeStorage(initial: Record<string, StoredPartials> = {}): PartialsStorage & {
  readonly store: Record<string, StoredPartials>;
  readPartials: Mock<typeof readPartials>;
  writePartials: Mock<typeof writePartials>;
  removePartials: Mock<typeof removePartials>;
  clearPartialAnswers: Mock<typeof clearPartialAnswers>;
} {
  const store: Record<string, StoredPartials> = { ...initial };
  return {
    store,
    readPartials: vi.fn<typeof readPartials>((questionnaireId) => store[questionnaireId]),
    writePartials: vi.fn<typeof writePartials>((session, answers) => {
      store[session.questionnaireId] = { formatVersion: PARTIALS_FORMAT_VERSION, sessionId: session.sessionId, questionnaireId: session.questionnaireId, answers, updatedAt: NOW };
    }),
    removePartials: vi.fn<typeof removePartials>((questionnaireId) => {
      delete store[questionnaireId];
    }),
    clearPartialAnswers: vi.fn<typeof clearPartialAnswers>((session) => {
      store[session.questionnaireId] = { formatVersion: PARTIALS_FORMAT_VERSION, sessionId: session.sessionId, questionnaireId: session.questionnaireId, answers: {}, updatedAt: NOW };
    }),
  };
}

type FakeStorage = ReturnType<typeof fakeStorage>;

function storedPartials(sessionId: string, answers: ClientAnswers): StoredPartials {
  return { formatVersion: PARTIALS_FORMAT_VERSION, sessionId, questionnaireId: INTAKE_QUESTIONNAIRE_ID, answers, updatedAt: NOW };
}

async function readySession(client: FakeClient, storage: FakeStorage) {
  client.createSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));
  const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);
  await session.enter();
  return session;
}

describe("enter", () => {
  it("starts a session and writes an empty envelope before dispatching, when nothing is stored", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.createSession).toHaveBeenCalledWith(INTAKE_QUESTIONNAIRE_ID);
    expect(client.getSession).not.toHaveBeenCalled();
    expect(storage.writePartials).toHaveBeenCalledWith(inProgressSession, {});
    expect(session.getState()).toMatchObject({ name: "ready", restoredAnswers: {}, restored: false });
  });

  it("calls the API once even when entered twice before the first call settles", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    const first = session.enter();
    const second = session.enter();
    await Promise.all([first, second]);

    expect(client.createSession).toHaveBeenCalledTimes(1);
  });

  it("shows the closed screen without writing anything when starting meets 409 questionnaire/closed", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce({ kind: "problem", slug: "questionnaire/closed", problem: problem("questionnaire/closed") });
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(storage.writePartials).not.toHaveBeenCalled();
    expect(session.getState()).toEqual({ name: "closed" });
  });

  it("shows the not-found screen when starting meets 404", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce({ kind: "problem", slug: "resource/not-found", problem: problem("resource/not-found") });
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(session.getState()).toEqual({ name: "notFound" });
  });

  it("resumes a stored session instead of starting a new one", async () => {
    const stored = storedPartials(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    const client = fakeClient();
    const storage = fakeStorage({ [INTAKE_QUESTIONNAIRE_ID]: stored });
    client.getSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(client.getSession).toHaveBeenCalledTimes(1);
    expect(client.getSession).toHaveBeenCalledWith(SESSION_ID);
    expect(client.createSession).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ name: "ready", restoredAnswers: stored.answers, restored: true });
  });

  it("shows the receipt and clears the stored answers when the resumed session was already submitted", async () => {
    const stored = storedPartials(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    const client = fakeClient();
    const storage = fakeStorage({ [INTAKE_QUESTIONNAIRE_ID]: stored });
    client.getSession.mockResolvedValueOnce(ok({ session: submittedSession, definition: intakeV1 }));
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(storage.clearPartialAnswers).toHaveBeenCalledWith(submittedSession);
    expect(session.getState()).toMatchObject({ name: "done", alreadySubmitted: false, receipt: { sessionId: SESSION_ID } });
  });

  it("removes a stale session on 404, starts a fresh one and does not restore its answers", async () => {
    const stale = storedPartials(STALE_SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    const client = fakeClient();
    const storage = fakeStorage({ [INTAKE_QUESTIONNAIRE_ID]: stale });
    client.getSession.mockResolvedValueOnce({ kind: "problem", slug: "resource/not-found", problem: problem("resource/not-found") });
    client.createSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(storage.removePartials).toHaveBeenCalledWith(INTAKE_QUESTIONNAIRE_ID);
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(storage.writePartials).toHaveBeenCalledWith(inProgressSession, {});
    expect(session.getState()).toMatchObject({ name: "ready", restoredAnswers: {}, restored: false });
  });

  it("shows the closed screen when resuming meets 409 questionnaire/closed, without starting a session", async () => {
    const stored = storedPartials(SESSION_ID, {});
    const client = fakeClient();
    const storage = fakeStorage({ [INTAKE_QUESTIONNAIRE_ID]: stored });
    client.getSession.mockResolvedValueOnce({ kind: "problem", slug: "questionnaire/closed", problem: problem("questionnaire/closed") });
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(session.getState()).toEqual({ name: "closed" });
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ["a network failure", networkError],
    ["an unexpected response", unexpectedResponse(503)],
    ["an internal problem", { kind: "problem" as const, slug: "internal" as const, problem: problem("internal", { detail: "trace-1" }) }],
  ])("records a failed start on %s, without writing to storage", async (_case, outcome) => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce(outcome);
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(storage.writePartials).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ name: "failed", step: "starting" });
  });

  it("records a failed resume on a network failure, leaving the stored answers untouched", async () => {
    const stored = storedPartials(SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    const client = fakeClient();
    const storage = fakeStorage({ [INTAKE_QUESTIONNAIRE_ID]: stored });
    client.getSession.mockResolvedValueOnce(networkError);
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.enter();

    expect(storage.removePartials).not.toHaveBeenCalled();
    expect(storage.writePartials).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ name: "failed", step: "resuming", stored });
  });
});

describe("changeAnswers", () => {
  it("does nothing when there is no form to change", () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    session.changeAnswers("itm_04");

    expect(storage.writePartials).not.toHaveBeenCalled();
  });

  it("no longer writes to storage itself; local persistence is the screen's job now", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    storage.writePartials.mockClear();

    session.changeAnswers("itm_04");

    expect(storage.writePartials).not.toHaveBeenCalled();
  });

  it("notifies subscribers when the change clears a server-rejected item's errors", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce({
      kind: "problem",
      slug: "submission/invalid",
      problem: problem("submission/invalid", { items: [{ itemId: "itm_04", code: "text/too-long" }] }),
    });
    await session.submit(noBranchAnswers);
    const listener = vi.fn();
    session.subscribe(listener);

    session.changeAnswers("itm_04");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ name: "ready", rejection: { itemErrors: {} } });
  });
});

describe("submit", () => {
  it("does nothing when there is no form to submit", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);

    await session.submit(noBranchAnswers);

    expect(client.submitSession).not.toHaveBeenCalled();
  });

  it("ignores a second submit while the first is still in flight", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    let resolveFirst: (outcome: Awaited<ReturnType<typeof submitSession>>) => void = () => undefined;
    client.submitSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    void session.submit(noBranchAnswers);
    void session.submit(noBranchAnswers);
    await Promise.resolve();

    expect(client.submitSession).toHaveBeenCalledTimes(1);
    resolveFirst(ok({ receipt }));
  });

  it("submits the visible answers, clears storage and shows the receipt on success", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce(ok({ receipt }));

    await session.submit(noBranchAnswers);

    const [sessionId, sentAnswers] = client.submitSession.mock.calls[0]!;
    expect(sessionId).toBe(SESSION_ID);
    expect(sentAnswers.unwrap()).toEqual(noBranchAnswers);
    expect(storage.clearPartialAnswers).toHaveBeenCalledWith(inProgressSession);
    expect(session.getState()).toMatchObject({ name: "done", alreadySubmitted: false, receipt });
  });

  it("returns to the form with the rejection on 422 submission/invalid, keeping the stored answers", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce({
      kind: "problem",
      slug: "submission/invalid",
      problem: problem("submission/invalid", { items: [{ itemId: "itm_04", code: "text/too-long" }] }),
    });

    await session.submit(noBranchAnswers);

    expect(storage.clearPartialAnswers).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ name: "ready", rejection: { itemErrors: { itm_04: ["text/too-long"] } } });
  });

  it("fetches and shows the recorded receipt on 409 session/already-submitted", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce({ kind: "problem", slug: "session/already-submitted", problem: problem("session/already-submitted") });
    client.getSession.mockResolvedValueOnce(ok({ session: submittedSession, definition: intakeV1 }));

    await session.submit(noBranchAnswers);

    expect(client.getSession).toHaveBeenCalledTimes(1);
    expect(client.getSession).toHaveBeenCalledWith(SESSION_ID);
    expect(storage.clearPartialAnswers).toHaveBeenCalledWith(inProgressSession);
    expect(session.getState()).toMatchObject({ name: "done", alreadySubmitted: true });
  });

  it("shows the closed screen on 409 questionnaire/closed, leaving the stored answers", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce({ kind: "problem", slug: "questionnaire/closed", problem: problem("questionnaire/closed") });

    await session.submit(noBranchAnswers);

    expect(storage.clearPartialAnswers).not.toHaveBeenCalled();
    expect(session.getState()).toEqual({ name: "closed" });
  });

  it.each([
    ["a network failure", networkError],
    ["an unexpected response", unexpectedResponse(500)],
    ["an internal problem", { kind: "problem" as const, slug: "internal" as const, problem: problem("internal", { detail: "trace-2" }) }],
  ])("records a failed submit on %s, keeping the stored answers", async (_case, outcome) => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce(outcome);

    await session.submit(noBranchAnswers);

    expect(storage.clearPartialAnswers).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ name: "failed", step: "submitting" });
  });
});

describe("retry", () => {
  it("does nothing when the session has not failed", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.createSession.mockClear();

    await session.retry();

    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("repeats the start request for a failed start", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce(networkError);
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);
    await session.enter();
    client.createSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));

    await session.retry();

    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(session.getState()).toMatchObject({ name: "ready" });
  });

  it("repeats the resume request for a failed resume, never starting a session", async () => {
    const stored = storedPartials(SESSION_ID, {});
    const client = fakeClient();
    const storage = fakeStorage({ [INTAKE_QUESTIONNAIRE_ID]: stored });
    client.getSession.mockResolvedValueOnce(networkError);
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);
    await session.enter();
    client.getSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));

    await session.retry();

    expect(client.getSession).toHaveBeenCalledTimes(2);
    expect(client.createSession).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ name: "ready" });
  });

  it("repeats the recorded-receipt fetch for a failed already-submitted lookup", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce({ kind: "problem", slug: "session/already-submitted", problem: problem("session/already-submitted") });
    client.getSession.mockResolvedValueOnce(networkError);
    await session.submit(noBranchAnswers);
    client.getSession.mockResolvedValueOnce(ok({ session: submittedSession, definition: intakeV1 }));

    await session.retry();

    expect(client.getSession).toHaveBeenCalledTimes(2);
    expect(session.getState()).toMatchObject({ name: "done", alreadySubmitted: true });
  });

  it("does not call the API for a failed submit, since the form resubmits instead", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    const session = await readySession(client, storage);
    client.submitSession.mockResolvedValueOnce(networkError);
    await session.submit(noBranchAnswers);

    await session.retry();

    expect(client.submitSession).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ name: "failed", step: "submitting" });
  });

  it("does nothing for a failure that repeating cannot fix", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce({ kind: "problem", slug: "request/invalid", problem: problem("request/invalid", { errors: [] }) });
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);
    await session.enter();

    await session.retry();

    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ name: "failed", step: "starting" });
  });
});

describe("startNewSession", () => {
  it("starts a session carrying the stored answers when a resume has failed", async () => {
    const stored = storedPartials(STALE_SESSION_ID, { itm_04: { type: "text", text: "Corner pharmacy" } });
    const client = fakeClient();
    const storage = fakeStorage({ [INTAKE_QUESTIONNAIRE_ID]: stored });
    client.getSession.mockResolvedValueOnce(networkError);
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);
    await session.enter();
    client.createSession.mockResolvedValueOnce(ok({ session: inProgressSession, definition: intakeV1 }));

    await session.startNewSession();

    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.createSession).toHaveBeenCalledWith(INTAKE_QUESTIONNAIRE_ID);
    expect(storage.writePartials).toHaveBeenCalledWith(inProgressSession, stored.answers);
    expect(session.getState()).toMatchObject({ name: "ready", restoredAnswers: stored.answers, restored: true });
  });

  it("does nothing when the failure was not a resume", async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    client.createSession.mockResolvedValueOnce(networkError);
    const session = createRespondentSession(INTAKE_QUESTIONNAIRE_ID, client, storage);
    await session.enter();
    client.createSession.mockClear();

    await session.startNewSession();

    expect(client.createSession).not.toHaveBeenCalled();
  });
});
