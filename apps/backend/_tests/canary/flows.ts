import { sensitive } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { emitDomainEvent, logger, withSpan, type DomainEvent, type TelemetryContext } from "@qp/telemetry";
import type { CanaryFlow } from "@qp/telemetry/canary";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import type { TestDatabase } from "../db/fixtures.js";
import { answersNo, answersYes, executionUrl, seedIntakeV1, startedSessionId, submit } from "../modules/execution/fixtures.js";
import { listSessionsUrl, sessionDetailUrl } from "../modules/reporting/fixtures.js";

export interface CanaryWorld {
  readonly app: FastifyInstance;
  readonly testDatabase: TestDatabase;
}

export type BackendCanaryFlow = CanaryFlow<CanaryWorld>;

const log = logger("canary");

function forgedContext(fields: Record<string, unknown>): TelemetryContext {
  return Object.assign<TelemetryContext, Record<string, unknown>>({}, fields);
}

function forgedEvent(fields: Record<string, unknown>): DomainEvent {
  return Object.assign<DomainEvent, Record<string, unknown>>(
    { name: "session.started", sessionId: "s-1", questionnaireId: "q-1", questionnaireVersion: 1 },
    fields,
  );
}

function withWhitespace(sentinel: string): string {
  return `patient answered ${sentinel}`;
}

function forgedRegistryContext(sentinel: string): TelemetryContext {
  return forgedContext({
    sessionId: withWhitespace(sentinel),
    questionnaireId: withWhitespace(sentinel),
    itemId: withWhitespace(sentinel),
    lastItemId: withWhitespace(sentinel),
    questionId: withWhitespace(sentinel),
    requestId: withWhitespace(sentinel),
    questionType: sentinel,
    outcome: sentinel,
    reason: sentinel,
    method: sentinel,
    route: sentinel,
    signal: sentinel,
    status: sentinel,
    elapsedSeconds: sentinel,
    durationMs: sentinel,
    errorStack: sentinel,
    answer: sentinel,
    text: sentinel,
    value: { text: sentinel },
  });
}

async function submitPlantedResponse(world: CanaryWorld, sentinel: string): Promise<string> {
  await seedIntakeV1(world.testDatabase);
  const sessionId = await startedSessionId(world.app);
  const response = await submit(world.app, sessionId, answersYes({ itm_04: { type: "text", text: sentinel } }));
  expect(response.statusCode, "the planted submit must be accepted for the flow to prove anything").toBe(200);
  const execution = await world.testDatabase.connect("execution");
  const stored = await execution.query<{ text_value: string }>(
    "SELECT text_value FROM execution.response WHERE session_id = $1 AND item_id = 'itm_04'",
    [sessionId],
  );
  expect(stored.rows[0]?.text_value, "the sentinel must be in the stored response").toBe(sentinel);
  return sessionId;
}

export const CANARY_FLOWS: readonly BackendCanaryFlow[] = [
  {
    name: "logger: forged context, unknown keys, Sensitive values and errors that carry the sentinel",
    run: async (_world, sentinel) => {
      log.info("forged context", forgedRegistryContext(sentinel));
      log.debug("wrapped answers", forgedContext({ sessionId: sensitive(sentinel), answer: sensitive(sentinel) }));
      log.warn("error message", { sessionId: "s-1" }, new Error(`answer was ${sentinel}`));
      log.error("error cause", undefined, new Error("outer", { cause: new Error(sentinel) }));
    },
  },
  {
    name: "withSpan: forged context, a log inside the span and a thrown error that carries the sentinel",
    run: async (_world, sentinel) => {
      const context = forgedRegistryContext(sentinel);
      await withSpan("session.submit", context, async () => {
        log.info("inside the span", context);
      });
      await withSpan("rule.evaluate", forgedContext({ sessionId: sensitive(sentinel) }), async () => {
        throw new Error(`answer was ${sentinel}`);
      }).catch(() => undefined);
    },
  },
  {
    name: "emitDomainEvent: payloads with the sentinel in closed-list fields, numbers and unknown keys",
    run: async (_world, sentinel) => {
      const ids = { sessionId: withWhitespace(sentinel), itemId: withWhitespace(sentinel), questionId: withWhitespace(sentinel) };
      emitDomainEvent(forgedEvent({ name: "session.question_answered", ...ids, questionType: sentinel, answer: sentinel }));
      emitDomainEvent(forgedEvent({ name: "session.answer_rejected", ...ids, reason: sentinel, answer: sentinel }));
      emitDomainEvent(
        forgedEvent({ name: "session.completed", sessionId: ids.sessionId, durationMs: sentinel, questionCount: sentinel }),
      );
      emitDomainEvent(forgedEvent({ name: "session.started", answer: sensitive(sentinel) }));
    },
  },
  {
    name: "execution: a real submit whose text answer is the sentinel",
    run: async (world, sentinel) => {
      await submitPlantedResponse(world, sentinel);
    },
  },
  {
    name: "execution: a submit rejected with 422 because an answer belongs to an unreachable item",
    run: async ({ app, testDatabase }, sentinel) => {
      await seedIntakeV1(testDatabase);
      const sessionId = await startedSessionId(app);
      const response = await submit(
        app,
        sessionId,
        answersNo({ itm_02: { type: "single_choice", optionId: "opt_hyperten" }, itm_04: { type: "text", text: sentinel } }),
      );
      expect(response.statusCode, "the planted submit must be rejected for the flow to prove anything").toBe(422);
    },
  },
  {
    name: "execution: a malformed submit body and a session URL that carry the sentinel",
    run: async ({ app }, sentinel) => {
      const malformed = await app.inject({
        method: "POST",
        url: executionUrl(`/sessions/${sentinel}/submit`),
        headers: { "content-type": "application/json" },
        payload: `{"answers": "${sentinel}`,
      });
      expect(malformed.statusCode).toBe(400);
      const unknown = await app.inject({ method: "GET", url: executionUrl(`/sessions/${sentinel}?answer=${sentinel}`) });
      expect(unknown.statusCode).toBeGreaterThanOrEqual(400);
    },
  },
  {
    name: "reporting: the stored sentinel answer read back through the responses list and the response detail",
    run: async (world, sentinel) => {
      const sessionId = await submitPlantedResponse(world, sentinel);
      const list = await world.app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID) });
      expect(list.statusCode).toBe(200);
      const detail = await world.app.inject({ method: "GET", url: sessionDetailUrl(INTAKE_QUESTIONNAIRE_ID, sessionId) });
      expect(detail.statusCode).toBe(200);
      expect(detail.body, "the read-back must return the planted answer for the flow to prove anything").toContain(sentinel);
    },
  },
];
