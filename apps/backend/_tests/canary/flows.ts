import { sensitive } from "@qp/shared";
import { INTAKE_ITEM_IDS, INTAKE_OPTION_IDS, INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { emitDomainEvent, FIELDS, logger, withSpan, type DomainEvent, type FieldName, type TelemetryContext } from "@qp/telemetry";
import { plantThirdPartyTelemetry, type CanaryFlow } from "@qp/telemetry/canary";
import { DrizzleQueryError } from "drizzle-orm";
import { expect } from "vitest";
import { SQLSTATE } from "../../src/db/errors.js";
import { InvariantViolation } from "../../src/invariant.js";
import { answersNo, answersYes, executionUrl, seedIntakeV1, startedSessionId, submit } from "../modules/execution/fixtures.js";
import { listSessionsUrl, sessionDetailUrl } from "../modules/reporting/fixtures.js";
import type { CanaryWorld } from "./harness.js";

export type BackendCanaryFlow = CanaryFlow<CanaryWorld>;

export const canaryLog = logger("canary");

export function forgedContext(fields: Record<string, unknown>): TelemetryContext {
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
  const fields = (Object.keys(FIELDS) as FieldName[]).map((name) => [
    name,
    FIELDS[name].accepts(sentinel) ? withWhitespace(sentinel) : sentinel,
  ]);
  return forgedContext({ ...Object.fromEntries(fields), answer: sentinel, text: sentinel, value: { text: sentinel } });
}

interface StoredAnswer {
  readonly text_value: string | null;
  readonly other_text: string | null;
}

async function storedAnswer(world: CanaryWorld, sessionId: string, itemId: string): Promise<StoredAnswer | undefined> {
  const execution = await world.testDatabase.connect("execution");
  const stored = await execution.query<StoredAnswer>(
    "SELECT text_value, other_text FROM execution.response WHERE session_id = $1 AND item_id = $2",
    [sessionId, itemId],
  );
  return stored.rows[0];
}

function otherAnswer(sentinel: string) {
  return { type: "single_choice", optionId: INTAKE_OPTION_IDS.other, otherText: sentinel } as const;
}

async function submitPlantedResponse(world: CanaryWorld, sentinel: string): Promise<string> {
  await seedIntakeV1(world.testDatabase);
  const sessionId = await startedSessionId(world.app);
  const response = await submit(
    world.app,
    sessionId,
    answersYes({
      [INTAKE_ITEM_IDS.whichCondition]: otherAnswer(sentinel),
      [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: sentinel },
    }),
  );
  expect(response.statusCode, "the planted submit must be accepted for the flow to prove anything").toBe(200);
  expect((await storedAnswer(world, sessionId, INTAKE_ITEM_IDS.pharmacy))?.text_value, "the sentinel must be a stored text answer").toBe(sentinel);
  expect((await storedAnswer(world, sessionId, INTAKE_ITEM_IDS.whichCondition))?.other_text, "the sentinel must be a stored other text").toBe(sentinel);
  return sessionId;
}

export const CANARY_FLOWS: readonly BackendCanaryFlow[] = [
  {
    name: "logger: forged context, unknown keys, Sensitive values and errors that carry the sentinel",
    run: async (_world, sentinel) => {
      canaryLog.info("forged context", forgedRegistryContext(sentinel));
      canaryLog.debug("wrapped answers", forgedContext({ sessionId: sensitive(sentinel), answer: sensitive(sentinel) }));
      canaryLog.warn("error message", { sessionId: "s-1" }, new Error(`answer was ${sentinel}`));
      canaryLog.error("error cause", undefined, new Error("outer", { cause: new Error(sentinel) }));
    },
  },
  {
    name: "withSpan: forged context, a log inside the span and a thrown error that carries the sentinel",
    run: async (_world, sentinel) => {
      const context = forgedRegistryContext(sentinel);
      await withSpan("session.submit", context, async () => {
        canaryLog.info("inside the span", context);
      });
      await withSpan("rule.evaluate", forgedContext({ sessionId: sensitive(sentinel) }), async () => {
        throw new Error(`answer was ${sentinel}`);
      }).catch(() => undefined);
    },
  },
  {
    name: "errors: Errors whose message is the bare sentinel or a frame-shaped line, logged and thrown inside withSpan",
    run: async (_world, sentinel) => {
      canaryLog.error("bare message", { sessionId: "s-1" }, new Error(sentinel));
      canaryLog.error("bare type error", undefined, new TypeError(sentinel));
      canaryLog.error("frame-shaped line", undefined, new Error(`header\n    at ${sentinel} (secret.txt:1:1)`));
      await withSpan("session.submit", { sessionId: "s-1" }, async () => {
        throw new Error(sentinel);
      }).catch(() => undefined);
    },
  },
  {
    name: "500 path: unhandled errors carrying the sentinel in their message, driver detail, frame-shaped lines and query parameters",
    run: async (world, sentinel) => {
      const frameShaped = `header\n    at ${sentinel} (secret.txt:1:1)`;
      const cause = Object.assign(new Error("duplicate"), { code: SQLSTATE.uniqueViolation, constraint: "response_pkey" });
      const failures = [
        new Error(sentinel),
        new TypeError(`bad value ${sentinel}`),
        Object.assign(new Error(`duplicate key value, Key (answer)=(${sentinel})`), {
          code: SQLSTATE.uniqueViolation,
          constraint: "response_pkey",
          detail: `Key (answer)=(${sentinel}) already exists.`,
        }),
        new Error(frameShaped),
        new DrizzleQueryError("insert into response (text_value) values (?)", [frameShaped], cause),
        InvariantViolation.of("session.not-marked-submitted", { sessionId: "s-1", questionnaireVersion: 2 }),
      ];
      for (const failure of failures) {
        expect(await world.injectFailure(failure, sentinel), "the queued failure must surface as a 500").toBe(500);
      }
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
        answersNo({
          [INTAKE_ITEM_IDS.whichCondition]: otherAnswer(sentinel),
          [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: sentinel },
        }),
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
    name: "auto-instrumentation: a real request with the sentinel in its URL, and third-party spans and metrics that carry it",
    run: async ({ app }, sentinel) => {
      const response = await app.inject({ method: "GET", url: executionUrl(`/sessions/${sentinel}?answer=${sentinel}`) });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      plantThirdPartyTelemetry(sentinel);
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
