import { problemType, PROBLEM_CONTENT_TYPE, responseDigest, type ResponseRow } from "@qp/shared";
import { INTAKE_QUESTION_IDS, INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { v4 as uuidv4 } from "uuid";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "../harness.js";
import {
  answersNo,
  answersYes,
  NOW,
  problemOf,
  publishMeasurementsQuestionnaire,
  SENTINEL_DATE,
  SENTINEL_TEXT,
  seedIntakeV1,
  startedSessionId,
  submit,
  freezeTimeAt,
  useExecutionApp,
} from "./fixtures.js";

const testDatabase = useTestDatabase();
const executionApp = useExecutionApp(testDatabase);

const SUBMITTED_AT = new Date(NOW.getTime() + 90_000);
const UUID_ITEM_KEY = "01a0950f-4100-7fcc-8acc-05dc6b75ce33";

interface StoredResponse {
  item_id: string;
  question_id: string;
  question_version: number;
  question_type: ResponseRow["type"];
  text_value: string | null;
  number_value: string | null;
  number_unit: string | null;
  date_value: string | null;
  option_ids: string[] | null;
  other_text: string | null;
  created_at: Date;
}

async function storedResponses(sessionId: string): Promise<StoredResponse[]> {
  const execution = await testDatabase.connect("execution");
  await execution.query("SET TIME ZONE 'UTC'");
  const result = await execution.query<StoredResponse>(
    `SELECT item_id, question_id, question_version, question_type, text_value, number_value::text AS number_value,
            number_unit, to_char(date_value, 'YYYY-MM-DD') AS date_value, option_ids, other_text, created_at
       FROM execution.response WHERE session_id = $1 ORDER BY item_id`,
    [sessionId],
  );
  return result.rows;
}

async function storedSession(sessionId: string) {
  const execution = await testDatabase.connect("execution");
  const result = await execution.query(
    "SELECT status, submitted_at, last_activity_at, response_digest FROM execution.session WHERE id = $1",
    [sessionId],
  );
  return result.rows[0];
}

function otherTextOf(row: StoredResponse): { otherText?: string } {
  return row.other_text === null ? {} : { otherText: row.other_text };
}

function rowFromColumns(row: StoredResponse): ResponseRow {
  const head = { itemId: row.item_id, questionId: row.question_id, questionVersion: row.question_version };
  switch (row.question_type) {
    case "text":
      return { ...head, type: "text", text: row.text_value! };
    case "number":
      return { ...head, type: "number", number: row.number_value!, ...(row.number_unit === null ? {} : { unit: row.number_unit }) };
    case "date":
      return { ...head, type: "date", date: row.date_value! };
    case "single_choice":
      return { ...head, type: "single_choice", optionIds: row.option_ids!, ...otherTextOf(row) };
    case "multiple_choice":
      return { ...head, type: "multiple_choice", optionIds: row.option_ids!, ...otherTextOf(row) };
  }
}

async function aStartedIntakeSession() {
  await seedIntakeV1(testDatabase);
  const app = executionApp();
  const sessionId = await startedSessionId(app);
  freezeTimeAt(SUBMITTED_AT);
  return { app, sessionId };
}

describe("POST /api/run/sessions/:sessionId/submit — accepted", () => {
  it("persists the yes path as one row per answer, pinned and stamped with the session's submitted_at, and returns the receipt", async () => {
    const { app, sessionId } = await aStartedIntakeSession();

    const response = await submit(app, sessionId, answersYes());

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      receipt: { sessionId, questionnaireId: INTAKE_QUESTIONNAIRE_ID, version: 1, submittedAt: SUBMITTED_AT.toISOString() },
    });
    expect(await storedResponses(sessionId)).toMatchObject([
      { item_id: "itm_01", question_id: INTAKE_QUESTION_IDS.hasCondition, question_version: 1, option_ids: ["yes"] },
      { item_id: "itm_02", question_id: INTAKE_QUESTION_IDS.whichCondition, question_version: 3, option_ids: ["opt_hyperten"] },
      { item_id: "itm_03", question_id: INTAKE_QUESTION_IDS.diagnosedOn, question_version: 1, date_value: "2019-04-02" },
      { item_id: "itm_04", question_id: INTAKE_QUESTION_IDS.pharmacy, question_version: 1, text_value: "Main Street Pharmacy" },
    ]);
    for (const row of await storedResponses(sessionId)) expect(row.created_at).toEqual(SUBMITTED_AT);
    expect(await storedSession(sessionId)).toMatchObject({
      status: "submitted",
      submitted_at: SUBMITTED_AT,
      last_activity_at: SUBMITTED_AT,
    });
  });

  it("persists the no path without rows for the skipped branch", async () => {
    const { app, sessionId } = await aStartedIntakeSession();

    const response = await submit(app, sessionId, answersNo({ itm_02: null, itm_03: null }));

    expect(response.statusCode).toBe(200);
    expect((await storedResponses(sessionId)).map((row) => row.item_id)).toEqual(["itm_01", "itm_04"]);
  });

  it("stores the canonical decimal with the unit taken from the pinned question, and a digest that recomputes from the stored rows", async () => {
    const measurements = await publishMeasurementsQuestionnaire(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app, measurements.questionnaireId);

    const response = await submit(app, sessionId, {
      itm_weight: { type: "number", value: "72.50" },
      itm_symptoms: { type: "multiple_choice", optionIds: ["other", "opt_cough"], otherText: "Headache" },
    });

    expect(response.statusCode).toBe(200);
    const rows = await storedResponses(sessionId);
    expect(rows).toMatchObject([
      { item_id: "itm_symptoms", option_ids: ["other", "opt_cough"], other_text: "Headache" },
      { item_id: "itm_weight", number_value: "72.5", number_unit: "kg" },
    ]);
    const recomputed = Buffer.from(await responseDigest(rows.map(rowFromColumns)));
    expect((await storedSession(sessionId)).response_digest).toEqual(recomputed);
  });

  it("accepts a not_future date one day ahead of UTC today and rejects two days ahead", async () => {
    const { app, sessionId } = await aStartedIntakeSession();

    const twoDaysAhead = await submit(app, sessionId, answersYes({ itm_03: { type: "date", date: "2026-09-16" } }));
    const oneDayAhead = await submit(app, sessionId, answersYes({ itm_03: { type: "date", date: "2026-09-15" } }));

    expect(problemOf(twoDaysAhead).items).toEqual([{ itemId: "itm_03", code: "date/in-future" }]);
    expect(oneDayAhead.statusCode).toBe(200);
  });
});

describe("POST /api/run/sessions/:sessionId/submit — idempotency", () => {
  it("replays the original receipt for the same answers, re-serialized, without writing again", async () => {
    const { app, sessionId } = await aStartedIntakeSession();
    const first = await submit(app, sessionId, answersNo());

    freezeTimeAt(new Date(SUBMITTED_AT.getTime() + 3_600_000));
    const retry = await submit(app, sessionId, {
      itm_04: { text: "Main Street Pharmacy", type: "text" },
      itm_02: null,
      itm_01: { optionId: "no", type: "single_choice" },
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(await storedResponses(sessionId)).toHaveLength(2);
  });

  it("replays a multiple-choice answer submitted in a different click order", async () => {
    const measurements = await publishMeasurementsQuestionnaire(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app, measurements.questionnaireId);
    const weight = { type: "number", value: "72.5" } as const;

    const first = await submit(app, sessionId, { itm_weight: weight, itm_symptoms: { type: "multiple_choice", optionIds: ["opt_fever", "opt_cough"] } });
    const retry = await submit(app, sessionId, {
      itm_weight: { type: "number", value: "72.500" },
      itm_symptoms: { type: "multiple_choice", optionIds: ["opt_cough", "opt_fever"] },
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
  });

  it("answers different answers on a submitted session with 409 session/already-submitted and keeps the original rows", async () => {
    const { app, sessionId } = await aStartedIntakeSession();
    await submit(app, sessionId, answersNo());
    const original = await storedResponses(sessionId);

    const different = await submit(app, sessionId, answersYes());
    const invalid = await submit(app, sessionId, { itm_01: { type: "single_choice", optionId: "no" } });

    for (const response of [different, invalid]) {
      expect(response.statusCode).toBe(409);
      expect(problemOf(response).type).toBe(problemType("session/already-submitted"));
    }
    expect(await storedResponses(sessionId)).toEqual(original);
  });

  it("replays the same answers after the questionnaire closes, because the submit happened before it", async () => {
    const { app, sessionId } = await aStartedIntakeSession();
    await submit(app, sessionId, answersNo());
    const definition = await testDatabase.connect("definition");
    await definition.query("UPDATE definition.questionnaire SET closes_at = $1 WHERE id = $2", [
      new Date(SUBMITTED_AT.getTime() + 1000),
      INTAKE_QUESTIONNAIRE_ID,
    ]);

    freezeTimeAt(new Date(SUBMITTED_AT.getTime() + 5000));
    const retry = await submit(app, sessionId, answersNo());

    expect(retry.statusCode).toBe(200);
    expect(retry.json().receipt.submittedAt).toBe(SUBMITTED_AT.toISOString());
  });

  it("serializes concurrent submits of the same answers on the session row: one write, two identical receipts", async () => {
    const { app, sessionId } = await aStartedIntakeSession();

    const responses = await Promise.all([submit(app, sessionId, answersYes()), submit(app, sessionId, answersYes())]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    expect(await storedResponses(sessionId)).toHaveLength(4);
  });

  it("lets exactly one of two concurrent, different submissions win", async () => {
    const { app, sessionId } = await aStartedIntakeSession();

    const responses = await Promise.all([submit(app, sessionId, answersYes()), submit(app, sessionId, answersNo())]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = responses.findIndex((response) => response.statusCode === 200);
    expect(await storedResponses(sessionId)).toHaveLength(winner === 0 ? 4 : 2);
  });
});

describe("POST /api/run/sessions/:sessionId/submit — rejected", () => {
  it("rejects an answer to an item the pinned definition hides, naming the item without echoing the value, and writes nothing", async () => {
    const { app, sessionId } = await aStartedIntakeSession();

    const response = await submit(
      app,
      sessionId,
      answersNo({ itm_02: { type: "single_choice", optionId: "other", otherText: SENTINEL_TEXT }, itm_03: { type: "date", date: SENTINEL_DATE } }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(problemOf(response)).toMatchObject({
      type: problemType("submission/invalid"),
      items: [
        { itemId: "itm_02", code: "answer/not-visible" },
        { itemId: "itm_03", code: "answer/not-visible" },
      ],
    });
    expect(response.body).not.toContain(SENTINEL_TEXT);
    expect(response.body).not.toContain(SENTINEL_DATE);
    expect(await storedResponses(sessionId)).toEqual([]);
    expect(await storedSession(sessionId)).toMatchObject({ status: "in_progress", submitted_at: null, response_digest: null });
  });

  it("rejects a missing required answer, an unknown item and a constraint violation together, all-or-nothing", async () => {
    const { app, sessionId } = await aStartedIntakeSession();

    const response = await submit(app, sessionId, {
      itm_01: { type: "single_choice", optionId: "yes" },
      itm_02: { type: "single_choice", optionId: "opt_unknown" },
      itm_03: { type: "text", text: SENTINEL_TEXT },
      itm_99: { type: "text", text: SENTINEL_TEXT },
    });

    expect(response.statusCode).toBe(422);
    expect(problemOf(response).items).toEqual([
      { itemId: "itm_02", code: "choice/unknown-option" },
      { itemId: "itm_03", code: "answer/type-mismatch" },
      { itemId: "itm_04", code: "answer/required" },
      { itemId: "itm_99", code: "answer/unknown-item" },
    ]);
    expect(response.body).not.toContain(SENTINEL_TEXT);
    expect(await storedResponses(sessionId)).toEqual([]);
  });

  it("rejects duplicate option ids as a 422 naming the item — the one response invariant the database does not hold", async () => {
    const measurements = await publishMeasurementsQuestionnaire(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app, measurements.questionnaireId);

    const response = await submit(app, sessionId, {
      itm_weight: { type: "number", value: "70" },
      itm_symptoms: { type: "multiple_choice", optionIds: ["opt_cough", "opt_cough"] },
    });

    expect(response.statusCode).toBe(422);
    expect(problemOf(response).items).toEqual([{ itemId: "itm_symptoms", code: "choice/duplicate-option" }]);
    expect(await storedResponses(sessionId)).toEqual([]);
  });

  it("rejects submitting an in-progress session past closes_at with 409 questionnaire/closed — a hard cutoff", async () => {
    const { app, sessionId } = await aStartedIntakeSession();
    const definition = await testDatabase.connect("definition");
    await definition.query("UPDATE definition.questionnaire SET closes_at = $1 WHERE id = $2", [SUBMITTED_AT, INTAKE_QUESTIONNAIRE_ID]);

    const response = await submit(app, sessionId, answersNo());

    expect(response.statusCode).toBe(409);
    expect(problemOf(response).type).toBe(problemType("questionnaire/closed"));
    expect(await storedSession(sessionId)).toMatchObject({ status: "in_progress" });
  });

  it("is 404 for an unknown session", async () => {
    const app = executionApp();

    const response = await submit(app, uuidv4(), answersNo());

    expect(problemOf(response)).toMatchObject({ type: problemType("resource/not-found"), status: 404 });
  });
});

describe("POST /api/run/sessions/:sessionId/submit — schema", () => {
  it.each([
    ["a JSON number instead of a decimal string", { itm_weight: { type: "number", value: 72.5 } }, "/body/answers/itm_weight"],
    ["a client-sent unit", { itm_weight: { type: "number", value: "72.5", unit: "lb" } }, "/body/answers/itm_weight"],
    ["a non-canonical decimal", { itm_weight: { type: "number", value: "1e3" } }, "/body/answers/itm_weight"],
    ["a uuid item key", { [UUID_ITEM_KEY]: { type: "text", text: SENTINEL_TEXT } }, `/body/answers/${UUID_ITEM_KEY}`],
  ])("rejects %s as 400 request/invalid, never coercing it, with a pointer and no value", async (_case, answers, pointer) => {
    const measurements = await publishMeasurementsQuestionnaire(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app, measurements.questionnaireId);

    const response = await submit(app, sessionId, answers);

    expect(response.statusCode).toBe(400);
    const body = problemOf(response);
    expect(body.type).toBe(problemType("request/invalid"));
    expect(body.errors?.map((error) => error.pointer)).toContain(pointer);
    expect(response.body).not.toContain(SENTINEL_TEXT);
    expect(response.body).not.toContain("72.5");
    expect(await storedResponses(sessionId)).toEqual([]);
  });

  it("rejects a body that is not JSON as 400 request/invalid", async () => {
    const app = executionApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/run/sessions/${uuidv4()}/submit`,
      headers: { "content-type": "application/json" },
      payload: `{"answers": {"itm_01": "${SENTINEL_TEXT}"`,
    });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response).type).toBe(problemType("request/invalid"));
    expect(response.body).not.toContain(SENTINEL_TEXT);
  });
});
