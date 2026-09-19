import { executionApi } from "@qp/shared";
import { INTAKE_ITEM_IDS, INTAKE_QUESTION_IDS, INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { MAX_FINDINGS } from "@qp/telemetry";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../../src/db/client.js";
import { executionModule } from "../../../src/modules/execution/plugin.js";
import { useTestDatabase } from "../../db/fixtures.js";
import { answersNo, answersYes, getSession, seedIntakeV1, startedSessionId, submit } from "./fixtures.js";
import { freezeTimeAt, NOW, useExecutionApp } from "./harness.js";

const testDatabase = useTestDatabase();
const executionApp = useExecutionApp(testDatabase);

const SESSION = "questionnaire.session_id";

let telemetry: TestTelemetry;
let extraApp: FastifyInstance | undefined;

beforeEach(() => {
  telemetry = installTestTelemetry();
});

afterEach(async () => {
  await extraApp?.close();
  extraApp = undefined;
  await telemetry.shutdown();
});

function failingTransactions(database: Database, when: "before" | "after"): Database {
  return new Proxy(database, {
    get(target, property) {
      if (property !== "transaction") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (work: Parameters<Database["transaction"]>[0], config?: Parameters<Database["transaction"]>[1]) => {
        if (when === "before") {
          throw new Error("the connection was lost");
        }
        return target.transaction(async (tx) => {
          await work(tx);
          throw new Error("the commit failed");
        }, config);
      };
    },
  });
}

async function appOver(database: Database): Promise<FastifyInstance> {
  const instance = Fastify();
  extraApp = instance;
  await instance.register(executionModule, { database, prefix: executionApi.EXECUTION_PREFIX });
  await instance.ready();
  return instance;
}

function eventLines(name: string) {
  return telemetry.logs().filter((line) => line.msg === name);
}

async function metricPoints(name: string) {
  const all = await telemetry.metrics();
  return all.find((metric) => metric.descriptor.name === name)?.dataPoints.map((point) => ({ value: point.value, attributes: point.attributes }));
}

async function closeIntakeAt(closesAt: Date): Promise<void> {
  const definition = await testDatabase.connect("definition");
  await definition.query("UPDATE definition.questionnaire SET closes_at = $1 WHERE id = $2", [closesAt, INTAKE_QUESTIONNAIRE_ID]);
}

describe("session.started and session.resumed", () => {
  it("emits started with the session, questionnaire and version, and resumed with the seconds since the start", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();

    const sessionId = await startedSessionId(app);
    freezeTimeAt(new Date(NOW.getTime() + 90_000));
    await getSession(app, sessionId);

    expect(eventLines("session.started")).toMatchObject([
      { [SESSION]: sessionId, "questionnaire.id": INTAKE_QUESTIONNAIRE_ID, "questionnaire.version": 1 },
    ]);
    expect(eventLines("session.resumed")).toMatchObject([
      { [SESSION]: sessionId, "questionnaire.id": INTAKE_QUESTIONNAIRE_ID, "questionnaire.version": 1, "questionnaire.elapsed_seconds": 90 },
    ]);
    expect(await metricPoints("questionnaire.sessions.started")).toEqual([{ value: 1, attributes: {} }]);
    expect(await metricPoints("questionnaire.sessions.resumed")).toEqual([{ value: 1, attributes: {} }]);
  });

  it("does not emit resumed when a submitted session is read back", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    await submit(app, sessionId, answersNo());

    await getSession(app, sessionId);

    expect(eventLines("session.resumed")).toEqual([]);
  });
});

describe("a submit that is accepted", () => {
  it("emits the answered and skipped items from the path it evaluated, then completed with the duration and the count", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);

    freezeTimeAt(new Date(NOW.getTime() + 90_000));
    const response = await submit(app, sessionId, answersNo());

    expect(response.statusCode).toBe(200);
    expect(eventLines("session.question_answered")).toMatchObject([
      {
        [SESSION]: sessionId,
        "questionnaire.item_id": INTAKE_ITEM_IDS.hasCondition,
        "questionnaire.question_id": INTAKE_QUESTION_IDS.hasCondition,
        "questionnaire.question_type": "single_choice",
      },
      {
        [SESSION]: sessionId,
        "questionnaire.item_id": INTAKE_ITEM_IDS.pharmacy,
        "questionnaire.question_id": INTAKE_QUESTION_IDS.pharmacy,
        "questionnaire.question_type": "text",
      },
    ]);
    expect(eventLines("session.item_skipped")).toMatchObject([
      { [SESSION]: sessionId, "questionnaire.item_id": INTAKE_ITEM_IDS.whichCondition, "questionnaire.question_id": INTAKE_QUESTION_IDS.whichCondition },
      { [SESSION]: sessionId, "questionnaire.item_id": INTAKE_ITEM_IDS.diagnosedOn, "questionnaire.question_id": INTAKE_QUESTION_IDS.diagnosedOn },
    ]);
    expect(eventLines("session.completed")).toMatchObject([
      { [SESSION]: sessionId, "questionnaire.duration_ms": 90_000, "questionnaire.question_count": 2 },
    ]);
    expect(await metricPoints("questionnaire.items.skipped")).toEqual([{ value: 2, attributes: {} }]);
    expect(await metricPoints("questionnaire.submissions")).toEqual([{ value: 1, attributes: { "questionnaire.outcome": "accepted" } }]);
    expect(await metricPoints("questionnaire.session.duration")).toHaveLength(1);
  });

  it("wraps the submit in a session.submit span with the outcome, and the evaluation in a rule.evaluate span on the same trace", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);

    await submit(app, sessionId, answersNo());

    const spans = telemetry.spans();
    const submitSpan = spans.find((span) => span.name === "session.submit");
    const evaluateSpan = spans.find((span) => span.name === "rule.evaluate");
    expect(submitSpan?.attributes).toEqual({
      [SESSION]: sessionId,
      "questionnaire.id": INTAKE_QUESTIONNAIRE_ID,
      "questionnaire.version": 1,
      "questionnaire.outcome": "accepted",
    });
    expect(evaluateSpan?.attributes).toEqual({
      [SESSION]: sessionId,
      "questionnaire.id": INTAKE_QUESTIONNAIRE_ID,
      "questionnaire.version": 1,
    });
    expect(evaluateSpan?.spanContext().traceId).toBe(submitSpan?.spanContext().traceId);
  });

  it("emits only the outcome when the same answers are replayed", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    await submit(app, sessionId, answersNo());
    telemetry.reset();

    const replay = await submit(app, sessionId, answersNo());

    expect(replay.statusCode).toBe(200);
    expect(eventLines("session.completed")).toEqual([]);
    expect(eventLines("session.question_answered")).toEqual([]);
    expect(eventLines("session.submit_finished")).toMatchObject([{ [SESSION]: sessionId, "questionnaire.outcome": "replayed" }]);
    const submissions = await metricPoints("questionnaire.submissions");
    expect(submissions).toContainEqual({ value: 1, attributes: { "questionnaire.outcome": "replayed" } });
    expect(submissions).toContainEqual({ value: 1, attributes: { "questionnaire.outcome": "accepted" } });
  });
});

describe("a submit that throws", () => {
  it("is counted as failed with no answer event when the transaction cannot start, and its span is an error", async () => {
    await seedIntakeV1(testDatabase);
    const sessionId = await startedSessionId(executionApp());
    const instance = await appOver(failingTransactions(testDatabase.database("execution"), "before"));

    const response = await submit(instance, sessionId, answersNo());

    expect(response.statusCode).toBe(500);
    expect(eventLines("session.submit_finished")).toMatchObject([{ [SESSION]: sessionId, "questionnaire.outcome": "failed" }]);
    expect(eventLines("session.submit_finished")[0]).not.toHaveProperty("questionnaire.id");
    for (const name of ["session.question_answered", "session.item_skipped", "session.completed", "session.answer_rejected"]) {
      expect(eventLines(name), name).toEqual([]);
    }
    expect(await metricPoints("questionnaire.submissions")).toEqual([{ value: 1, attributes: { "questionnaire.outcome": "failed" } }]);
    const span = telemetry.spans().find((candidate) => candidate.name === "session.submit");
    expect(span?.attributes).toMatchObject({ [SESSION]: sessionId, "questionnaire.outcome": "failed", "error.type": "Error" });
  });

  it("emits no answer or completion event when the transaction rolls back after its work, and stores nothing", async () => {
    await seedIntakeV1(testDatabase);
    const sessionId = await startedSessionId(executionApp());
    const instance = await appOver(failingTransactions(testDatabase.database("execution"), "after"));

    const response = await submit(instance, sessionId, answersNo());

    expect(response.statusCode).toBe(500);
    for (const name of ["session.question_answered", "session.item_skipped", "session.completed"]) {
      expect(eventLines(name), name).toEqual([]);
    }
    expect(eventLines("session.submit_finished")).toMatchObject([{ "questionnaire.outcome": "failed" }]);
    const execution = await testDatabase.connect("execution");
    const stored = await execution.query("SELECT (SELECT count(*)::int FROM execution.response) AS responses, (SELECT status FROM execution.session WHERE id = $1) AS status", [sessionId]);
    expect(stored.rows[0]).toEqual({ responses: 0, status: "in_progress" });
  });
});

describe("a submit that is refused", () => {
  it("emits one answer_rejected per item code, with no item or question for an unknown item key", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);

    const response = await submit(app, sessionId, answersNo({ [INTAKE_ITEM_IDS.whichCondition]: { type: "text", text: "x" }, itm_99: { type: "text", text: "x" } }));

    expect(response.statusCode).toBe(422);
    const rejected = eventLines("session.answer_rejected");
    expect(rejected).toMatchObject([
      {
        [SESSION]: sessionId,
        "questionnaire.item_id": INTAKE_ITEM_IDS.whichCondition,
        "questionnaire.question_id": INTAKE_QUESTION_IDS.whichCondition,
        "questionnaire.reason": "answer/not-visible",
      },
      { [SESSION]: sessionId, "questionnaire.reason": "answer/unknown-item" },
    ]);
    expect(rejected[1]).not.toHaveProperty("questionnaire.item_id");
    expect(rejected[1]).not.toHaveProperty("questionnaire.question_id");
    expect(await metricPoints("questionnaire.answers.rejected")).toEqual(
      expect.arrayContaining([
        { value: 1, attributes: { "questionnaire.reason": "answer/not-visible" } },
        { value: 1, attributes: { "questionnaire.reason": "answer/unknown-item" } },
      ]),
    );
    expect(await metricPoints("questionnaire.submissions")).toEqual([
      { value: 1, attributes: { "questionnaire.outcome": "rejected_validation" } },
    ]);
    expect(eventLines("session.completed")).toEqual([]);
  });

  it("emits at most the shared findings cap of answer_rejected events, however many unknown keys are sent", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    const unknownKeys = Object.fromEntries(Array.from({ length: 120 }, (_unused, index) => [`itm_x${index}`, { type: "text", text: "x" } as const]));

    const response = await submit(app, sessionId, answersNo(unknownKeys));

    expect(response.statusCode).toBe(422);
    expect(eventLines("session.answer_rejected")).toHaveLength(MAX_FINDINGS);
    expect(await metricPoints("questionnaire.answers.rejected")).toEqual([
      { value: MAX_FINDINGS, attributes: { "questionnaire.reason": "answer/unknown-item" } },
    ]);
    expect(await metricPoints("questionnaire.submissions")).toEqual([
      { value: 1, attributes: { "questionnaire.outcome": "rejected_validation" } },
    ]);
  });

  it("counts a submit with different answers after the session was submitted as a conflict, with no answer events", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    await submit(app, sessionId, answersNo());
    telemetry.reset();

    const response = await submit(app, sessionId, answersYes());

    expect(response.statusCode).toBe(409);
    expect(eventLines("session.submit_finished")).toMatchObject([{ [SESSION]: sessionId, "questionnaire.outcome": "rejected_conflict" }]);
    for (const name of ["session.question_answered", "session.completed", "session.rejected_past_cutoff"]) {
      expect(eventLines(name), name).toEqual([]);
    }
  });

  it("counts a submit after the cutoff as rejected past the cutoff and as a conflict, and emits no answer events", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const sessionId = await startedSessionId(app);
    await closeIntakeAt(new Date(NOW.getTime() + 1000));

    freezeTimeAt(new Date(NOW.getTime() + 1000));
    const response = await submit(app, sessionId, answersYes());

    expect(response.statusCode).toBe(409);
    expect(eventLines("session.rejected_past_cutoff")).toMatchObject([
      { [SESSION]: sessionId, "questionnaire.id": INTAKE_QUESTIONNAIRE_ID, "questionnaire.version": 1 },
    ]);
    expect(await metricPoints("questionnaire.sessions.rejected_past_cutoff")).toEqual([{ value: 1, attributes: {} }]);
    expect(await metricPoints("questionnaire.submissions")).toEqual([
      { value: 1, attributes: { "questionnaire.outcome": "rejected_conflict" } },
    ]);
    expect(eventLines("session.question_answered")).toEqual([]);
  });

  it("emits nothing for a session that does not exist", async () => {
    const app = executionApp();

    const response = await submit(app, "5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d", answersNo());

    expect(response.statusCode).toBe(404);
    expect(eventLines("session.submit_finished")).toEqual([]);
  });
});
