import { problemType, PROBLEM_CONTENT_TYPE } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID, intakeDefinition } from "@qp/shared/demo";
import { v4 as uuidv4 } from "uuid";
import { describe, expect, it } from "vitest";
import { createQuestionnaire } from "../../../src/db/definition/questionnaires.js";
import { useTestDatabase } from "../harness.js";
import {
  answersNo,
  getSession,
  NOW,
  problemOf,
  seedIntakeV1,
  startedSessionId,
  startSession,
  submit,
  freezeTimeAt,
  useExecutionApp,
} from "./fixtures.js";

const testDatabase = useTestDatabase();
const executionApp = useExecutionApp(testDatabase);

async function closeIntakeAt(closesAt: Date): Promise<void> {
  const definition = await testDatabase.connect("definition");
  await definition.query("UPDATE definition.questionnaire SET closes_at = $1 WHERE id = $2", [closesAt, INTAKE_QUESTIONNAIRE_ID]);
}

describe("POST /api/run/sessions", () => {
  it("pins the current published version and returns its snapshot in the same response", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();

    const response = await startSession(app);

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body.definition).toEqual(intakeDefinition(1));
    expect(body.session).toEqual({
      sessionId: expect.any(String),
      questionnaireId: INTAKE_QUESTIONNAIRE_ID,
      version: 1,
      status: "in_progress",
      startedAt: NOW.toISOString(),
      submittedAt: null,
    });
    const execution = await testDatabase.connect("execution");
    const stored = await execution.query(
      `SELECT s.status, s.version, v.version AS pinned_version, s.started_at
         FROM execution.session s
         JOIN definition.published_questionnaire_version v ON v.id = s.questionnaire_version_id
        WHERE s.id = $1`,
      [body.session.sessionId],
    );
    expect(stored.rows).toEqual([{ status: "in_progress", version: 1, pinned_version: 1, started_at: NOW }]);
  });

  it("issues random v4 session ids, so a session id is not enumerable", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();

    const ids = [await startedSessionId(app), await startedSessionId(app)];

    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("answers an unknown questionnaire and a never-published one with the same 404", async () => {
    const definition = testDatabase.database("definition");
    const draftOnly = await createQuestionnaire(definition, {
      key: null,
      name: "Draft",
      title: "Draft",
      createdBy: "test",
      traceId: null,
    });
    const app = executionApp();

    const unknown = await startSession(app, uuidv4());
    const unpublished = await startSession(app, draftOnly.questionnaireId);

    for (const response of [unknown, unpublished]) {
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
      expect(problemOf(response)).toMatchObject({ type: problemType("resource/not-found"), status: 404 });
    }
    const execution = await testDatabase.connect("execution");
    expect((await execution.query("SELECT count(*)::int AS n FROM execution.session")).rows[0].n).toBe(0);
  });

  it("refuses to start once closes_at has passed, including the exact instant, and starts while it is in the future", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();

    await closeIntakeAt(new Date(NOW.getTime() + 1));
    expect((await startSession(app)).statusCode).toBe(201);

    freezeTimeAt(new Date(NOW.getTime() + 1));
    const atClose = await startSession(app);

    expect(atClose.statusCode).toBe(409);
    expect(problemOf(atClose)).toMatchObject({ type: problemType("questionnaire/closed"), status: 409 });
    const execution = await testDatabase.connect("execution");
    expect((await execution.query("SELECT count(*)::int AS n FROM execution.session")).rows[0].n).toBe(1);
  });

  it("rejects a malformed questionnaire id and an unexpected body field as 400 request/invalid", async () => {
    const app = executionApp();

    const malformed = await startSession(app, "not-a-uuid");
    const extra = await app.inject({
      method: "POST",
      url: "/api/run/sessions",
      payload: { questionnaireId: INTAKE_QUESTIONNAIRE_ID, version: 1 },
    });

    expect(problemOf(malformed)).toMatchObject({
      type: problemType("request/invalid"),
      status: 400,
      errors: [{ pointer: "/body/questionnaireId", code: "schema/format" }],
    });
    expect(problemOf(extra)).toMatchObject({
      status: 400,
      errors: [{ pointer: "/body/version", code: "schema/additionalProperties" }],
    });
  });
});

describe("GET /api/run/sessions/:sessionId", () => {
  it("returns the session and its pinned definition, uncached", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const started = (await startSession(app)).json();

    const resumed = await getSession(app, started.session.sessionId);

    expect(resumed.statusCode).toBe(200);
    expect(resumed.headers["cache-control"]).toBe("no-store");
    expect(resumed.json()).toEqual(started);
  });

  it("is 404 for an unknown session and 400 for a malformed id", async () => {
    const app = executionApp();

    const unknown = await getSession(app, uuidv4());
    const malformed = await getSession(app, "12345");

    expect(problemOf(unknown)).toMatchObject({ type: problemType("resource/not-found"), status: 404 });
    expect(problemOf(malformed)).toMatchObject({
      status: 400,
      errors: [{ pointer: "/params/sessionId", code: "schema/format" }],
    });
  });

  it("writes nothing on resume", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    const execution = await testDatabase.connect("execution");
    const before = (await execution.query("SELECT * FROM execution.session WHERE id = $1", [sessionId])).rows;

    freezeTimeAt(new Date(NOW.getTime() + 60_000));
    await getSession(app, sessionId);

    expect((await execution.query("SELECT * FROM execution.session WHERE id = $1", [sessionId])).rows).toEqual(before);
  });

  it("refuses to resume an in-progress session once the questionnaire has closed", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    await closeIntakeAt(new Date(NOW.getTime() + 1000));

    freezeTimeAt(new Date(NOW.getTime() + 1000));
    const resumed = await getSession(app, sessionId);

    expect(resumed.statusCode).toBe(409);
    expect(problemOf(resumed).type).toBe(problemType("questionnaire/closed"));
  });

  it("still returns a submitted session after the close, so the respondent app can render its receipt", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    freezeTimeAt(new Date(NOW.getTime() + 500));
    expect((await submit(app, sessionId, answersNo())).statusCode).toBe(200);
    await closeIntakeAt(new Date(NOW.getTime() + 1000));

    freezeTimeAt(new Date(NOW.getTime() + 2000));
    const resumed = await getSession(app, sessionId);

    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().session).toMatchObject({
      status: "submitted",
      submittedAt: new Date(NOW.getTime() + 500).toISOString(),
    });
  });
});
