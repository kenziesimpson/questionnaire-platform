import { sensitive, telemetryApi } from "@qp/shared";
import { INTAKE_ITEM_IDS, INTAKE_OPTION_IDS, INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { emitDomainEvent, FIELDS, logger, MAX_FINDINGS, withSpan, type DomainEvent, type FieldName, type TelemetryContext } from "@qp/telemetry";
import { plantThirdPartyTelemetry, type LeakFlow } from "@qp/telemetry/leak-test";
import { DrizzleQueryError } from "drizzle-orm";
import { expect } from "vitest";
import { SQLSTATE } from "../../src/db/errors.js";
import { encodeCursor } from "../../src/db/reporting/cursor.js";
import { InvariantViolation } from "../../src/invariant.js";
import { SESSION_ID } from "../http/fixtures.js";
import { definitionUrl } from "../modules/definition/fixtures.js";
import { answersNo, answersYes, executionUrl, getSession, seedIntakeV1, startedSessionId, submit } from "../modules/execution/fixtures.js";
import { listSessionsUrl, sessionDetailUrl } from "../modules/reporting/fixtures.js";
import type { LeakWorld } from "./harness.js";

export type BackendLeakFlow = LeakFlow<LeakWorld>;

export const leakLog = logger("execution");

const OVER_CAP = MAX_FINDINGS + 15;

function forgedContext(fields: Record<string, unknown>): TelemetryContext {
  return Object.assign<TelemetryContext, Record<string, unknown>>({}, fields);
}

function forgedEvent(fields: Record<string, unknown>): DomainEvent {
  return Object.assign<DomainEvent, Record<string, unknown>>(
    { name: "session.started", sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID, questionnaireVersion: 1 },
    fields,
  );
}

function withWhitespace(sentinel: string): string {
  return `patient answered ${sentinel}`;
}

function lowerCased(sentinel: string): TelemetryContext {
  const value = sentinel.toLowerCase();
  return {
    sessionId: value,
    questionnaireId: value,
    questionnaireVersionId: value,
    questionId: value,
    requestId: value,
    errorType: value,
    errorCode: value,
    invariant: value,
  };
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

async function storedAnswer(world: LeakWorld, sessionId: string, itemId: string): Promise<StoredAnswer | undefined> {
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

async function submitPlantedResponse(world: LeakWorld, sentinel: string): Promise<string> {
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

export const LEAK_FLOWS: readonly BackendLeakFlow[] = [
  {
    name: "logger: forged context, unknown keys, Sensitive values and errors that carry the sentinel",
    run: async (_world, sentinel) => {
      leakLog.info("forged context", forgedRegistryContext(sentinel));
      leakLog.debug("wrapped answers", forgedContext({ sessionId: sensitive(sentinel), answer: sensitive(sentinel) }));
      leakLog.warn("error message", { sessionId: SESSION_ID }, new Error(`answer was ${sentinel}`));
      leakLog.error("error cause", undefined, new Error("outer", { cause: new Error(sentinel) }));
    },
  },
  {
    name: "withSpan: forged context, a log inside the span and a thrown error that carries the sentinel",
    run: async (_world, sentinel) => {
      const context = forgedRegistryContext(sentinel);
      await withSpan("session.submit", context, async () => {
        leakLog.info("inside the span", context);
      });
      await withSpan("rule.evaluate", forgedContext({ sessionId: sensitive(sentinel) }), async () => {
        throw new Error(`answer was ${sentinel}`);
      }).catch(() => undefined);
    },
  },
  {
    name: "withSpan: a span name that is the sentinel, in either case, still runs the callback and exports no span",
    run: async (_world, sentinel) => {
      for (const name of [sentinel, sentinel.toLowerCase()]) {
        let ran = false;
        // @ts-expect-error — the name is a string, not a SpanName
        await withSpan(name, { sessionId: SESSION_ID }, async () => {
          ran = true;
          leakLog.info("inside the span", { sessionId: SESSION_ID });
        });
        expect(ran, "an unknown span name must still run the callback").toBe(true);
      }
    },
  },
  {
    name: "logger and withSpan: the lower-cased sentinel in every uuid, error class, SQLSTATE and invariant field",
    run: async (_world, sentinel) => {
      leakLog.info("lower-cased ids", lowerCased(sentinel));
      await withSpan("session.submit", lowerCased(sentinel), async () => {
        leakLog.info("inside the span", lowerCased(sentinel));
      });
    },
  },
  {
    name: "errors: Errors whose message is the bare sentinel or a frame-shaped line, logged and thrown inside withSpan",
    run: async (_world, sentinel) => {
      leakLog.error("bare message", { sessionId: SESSION_ID }, new Error(sentinel));
      leakLog.error("bare type error", undefined, new TypeError(sentinel));
      leakLog.error("frame-shaped line", undefined, new Error(`header\n    at ${sentinel} (secret.txt:1:1)`));
      await withSpan("session.submit", { sessionId: SESSION_ID }, async () => {
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
        InvariantViolation.of("session.not-marked-submitted", { sessionId: SESSION_ID, questionnaireVersion: 2 }),
      ];
      for (const failure of failures) {
        expect(await world.injectFailure(failure, sentinel), "the queued failure must surface as a 500").toBe(500);
      }
    },
  },
  {
    name: "database: the sentinel as a bound parameter of statements pg's instrumentation traces, on a client and on a pool, that succeed and that fail with the value in the driver's message",
    run: async (world, sentinel) => {
      const client = await world.testDatabase.connect("execution");
      const pool = world.testDatabase.pool("reporting");

      const echoed = await client.query<{ echoed: string }>("SELECT $1::text AS echoed", [sentinel]);
      const pooled = await pool.query<{ echoed: string }>({ text: "SELECT $1::text AS echoed", values: [sentinel] });
      expect([echoed.rows[0]?.echoed, pooled.rows[0]?.echoed], "the sentinel must reach the database as a bound parameter").toEqual([sentinel, sentinel]);

      const failures = [
        await client.query("SELECT $1::uuid", [sentinel]).then(() => undefined, (error: unknown) => error),
        await pool.query({ text: "SELECT $1::integer", values: [sentinel] }).then(() => undefined, (error: unknown) => error),
      ];
      for (const failure of failures) {
        expect(failure, "the statement must fail").toBeInstanceOf(Error);
        const message = failure instanceof Error ? failure.message : "";
        expect(message, "the driver must echo the planted value in its message for the flow to prove anything").toContain(sentinel);
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
      emitDomainEvent(
        forgedEvent({ name: "session.submit_finished", sessionId: ids.sessionId, questionnaireId: sentinel, outcome: sentinel, answer: sentinel }),
      );
      emitDomainEvent(
        forgedEvent({ name: "session.answer_rejected", sessionId: ids.sessionId, itemId: null, questionId: null, reason: sentinel, answer: sentinel }),
      );
      emitDomainEvent(forgedEvent({ name: "session.answers_rejected", sessionId: ids.sessionId, reason: sentinel, codeFindingCount: 35, answer: sentinel }));
      emitDomainEvent(
        forgedEvent({ name: "questionnaire.publish_items_rejected", questionnaireId: sentinel, problemCode: sentinel, codeFindingCount: 35, answer: sentinel }),
      );
      emitDomainEvent(forgedEvent({ name: "questionnaire.publish_rejected", questionnaireId: sentinel, itemId: ids.itemId, problemCode: sentinel, answer: sentinel }));
      emitDomainEvent(forgedEvent({ name: "session.item_skipped", ...ids, answer: sentinel }));
      emitDomainEvent(forgedEvent({ name: "session.rejected_past_cutoff", sessionId: ids.sessionId, questionnaireId: sentinel, answer: sentinel }));
    },
  },
  {
    name: "execution: a real submit whose text answer is the sentinel",
    emits: ["session.started", "session.question_answered", "session.completed", "session.submit_finished"],
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
    name: "execution: a submit rejected with 422 for a known item, an unknown item key that is the lower-cased sentinel and a hundred more unknown keys",
    emits: ["session.answer_rejected", "session.answers_rejected", "session.submit_finished"],
    run: async ({ app, testDatabase }, sentinel) => {
      await seedIntakeV1(testDatabase);
      const sessionId = await startedSessionId(app);
      const manyUnknownKeys = Object.fromEntries(
        Array.from({ length: 100 }, (_unused, index) => [`${sentinel.toLowerCase()}_${index}`, { type: "text", text: sentinel } as const]),
      );
      const response = await submit(
        app,
        sessionId,
        answersYes({
          [INTAKE_ITEM_IDS.whichCondition]: { type: "single_choice", optionId: INTAKE_OPTION_IDS.hypertension, otherText: sentinel },
          [sentinel.toLowerCase()]: { type: "text", text: sentinel },
          ...manyUnknownKeys,
        }),
      );
      expect(response.statusCode, "the planted submit must be rejected for the flow to prove anything").toBe(422);
      expect(response.body, "the rejection must name the unknown key for the flow to prove anything").toContain(sentinel.toLowerCase());
    },
  },
  {
    name: "execution: a submit that skips the items an answer hides and carries the sentinel in the one it answers",
    emits: ["session.item_skipped", "session.question_answered", "session.completed"],
    run: async (world, sentinel) => {
      await seedIntakeV1(world.testDatabase);
      const sessionId = await startedSessionId(world.app);
      const response = await submit(world.app, sessionId, answersNo({ [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: sentinel } }));
      expect(response.statusCode, "the planted submit must be accepted for the flow to prove anything").toBe(200);
      expect((await storedAnswer(world, sessionId, INTAKE_ITEM_IDS.pharmacy))?.text_value, "the sentinel must be a stored text answer").toBe(sentinel);
    },
  },
  {
    name: "execution: a submit after the questionnaire's cutoff; a path-coverage flow, since the cutoff path never sees the answers",
    emits: ["session.rejected_past_cutoff", "session.submit_finished"],
    run: async ({ app, testDatabase }, sentinel) => {
      await seedIntakeV1(testDatabase);
      const sessionId = await startedSessionId(app);
      const definition = await testDatabase.connect("definition");
      await definition.query("UPDATE definition.questionnaire SET closes_at = $1 WHERE id = $2", [
        new Date(Date.now() - 3_600_000),
        INTAKE_QUESTIONNAIRE_ID,
      ]);
      const response = await submit(app, sessionId, answersYes({ [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: sentinel } }));
      expect(response.statusCode, "the planted submit must be refused as closed for the flow to prove anything").toBe(409);
    },
  },
  {
    name: "execution: a session resumed, submitted and then replayed with the same answers and with different ones",
    emits: ["session.started", "session.resumed", "session.completed", "session.submit_finished"],
    run: async ({ app, testDatabase }, sentinel) => {
      await seedIntakeV1(testDatabase);
      const sessionId = await startedSessionId(app);
      expect((await getSession(app, sessionId)).statusCode).toBe(200);
      const answers = answersYes({ [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: sentinel } });
      expect((await submit(app, sessionId, answers)).statusCode, "the planted submit must be accepted").toBe(200);
      expect((await submit(app, sessionId, answers)).statusCode, "the same answers replay").toBe(200);
      const different = answersYes({ [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: `${sentinel} again` } });
      expect((await submit(app, sessionId, different)).statusCode, "different answers conflict").toBe(409);
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
    name: "definition: a draft saved, a stale save refused with 409, a publish refused with 422, then published and retired, with the sentinel in every title, prompt and option label",
    emits: [
      "questionnaire.created",
      "questionnaire.draft_conflict",
      "questionnaire.publish_rejected",
      "questionnaire.publish_items_rejected",
      "questionnaire.published",
      "questionnaire.publish_finished",
      "questionnaire.retired",
    ],
    run: async ({ app }, sentinel) => {
      const post = (path: string, payload?: object) =>
        app.inject({ method: "POST", url: definitionUrl(path), ...(payload === undefined ? {} : { payload }) });
      const choice = await post("/questions", {
        question: {
          type: "single_choice",
          prompt: sentinel,
          options: [
            { optionId: "yes", label: sentinel },
            { optionId: "no", label: `${sentinel} no` },
          ],
        },
      });
      const text = await post("/questions", { question: { type: "text", prompt: `${sentinel} follow up` } });
      const created = await post("/questionnaires", { name: sentinel, title: sentinel });
      expect([choice.statusCode, text.statusCode, created.statusCode], "the planted questions and questionnaire must be stored").toEqual([201, 201, 201]);
      const questionnaireId: string = created.json().questionnaireId;
      const placement = (itemId: string, questionId: string, visibleWhen: object | null) => ({
        itemId,
        required: false,
        visibleWhen,
        questionId,
        questionVersion: 1,
      });
      const save = (etag: string, items: object[]) =>
        app.inject({
          method: "PUT",
          url: definitionUrl(`/questionnaires/${questionnaireId}/draft`),
          headers: { "if-match": etag },
          payload: { title: sentinel, items },
        });
      const forwardReference = { all: [{ type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" }] };

      const opened = await app.inject({ method: "GET", url: definitionUrl(`/questionnaires/${questionnaireId}/draft`) });
      const firstEtag = String(opened.headers.etag);
      const invalid = await save(firstEtag, [
        placement("itm_01", choice.json().questionId, forwardReference),
        placement("itm_02", text.json().questionId, null),
      ]);
      const stale = await save(firstEtag, []);
      const invalidEtag = String(invalid.headers.etag);
      const refused = await app.inject({
        method: "POST",
        url: definitionUrl(`/questionnaires/${questionnaireId}/publish`),
        headers: { "if-match": invalidEtag },
      });
      expect([invalid.statusCode, stale.statusCode, refused.statusCode], "the planted draft must be saved, the stale save and the publish refused").toEqual([200, 409, 422]);

      const valid = await save(invalidEtag, [placement("itm_01", choice.json().questionId, null), placement("itm_02", text.json().questionId, null)]);
      const published = await app.inject({
        method: "POST",
        url: definitionUrl(`/questionnaires/${questionnaireId}/publish`),
        headers: { "if-match": String(valid.headers.etag) },
      });
      const retired = await app.inject({
        method: "PUT",
        url: definitionUrl(`/questionnaires/${questionnaireId}/closes-at`),
        payload: { closesAt: "2026-10-01T00:00:00.000Z" },
      });
      expect([valid.statusCode, published.statusCode, retired.statusCode], "the planted draft must publish and retire").toEqual([200, 201, 200]);
    },
  },
  {
    name: "definition: a publish refused with 422 for more items than the findings cap, with the sentinel in every title and prompt",
    emits: ["questionnaire.publish_rejected", "questionnaire.publish_items_rejected", "questionnaire.publish_finished"],
    run: async ({ app }, sentinel) => {
      const post = (path: string, payload?: object) =>
        app.inject({ method: "POST", url: definitionUrl(path), ...(payload === undefined ? {} : { payload }) });
      const created = await post("/questionnaires", { name: sentinel, title: sentinel });
      expect(created.statusCode, "the planted questionnaire must be stored").toBe(201);
      const questionnaireId: string = created.json().questionnaireId;
      const items: object[] = [];
      for (let index = 0; index < OVER_CAP; index += 1) {
        const question = await post("/questions", { question: { type: "text", prompt: `${sentinel} ${index}` } });
        expect(question.statusCode, "the planted question must be stored").toBe(201);
        items.push({
          itemId: `itm_${index}`,
          required: false,
          visibleWhen: { all: [{ type: "single_choice", itemId: "itm_missing", op: "is", optionId: "yes" }] },
          questionId: question.json().questionId,
          questionVersion: 1,
        });
      }
      const opened = await app.inject({ method: "GET", url: definitionUrl(`/questionnaires/${questionnaireId}/draft`) });
      const saved = await app.inject({
        method: "PUT",
        url: definitionUrl(`/questionnaires/${questionnaireId}/draft`),
        headers: { "if-match": String(opened.headers.etag) },
        payload: { title: sentinel, items },
      });
      expect(saved.statusCode, "the planted draft must be saved").toBe(200);
      const refused = await app.inject({
        method: "POST",
        url: definitionUrl(`/questionnaires/${questionnaireId}/publish`),
        headers: { "if-match": String(saved.headers.etag) },
      });
      expect(refused.statusCode, "the planted publish must be refused for the flow to prove anything").toBe(422);
      expect(refused.json<{ items: unknown[] }>().items, "the refusal must name every item, past the findings cap").toHaveLength(OVER_CAP);
    },
  },
  {
    name: "telemetry ingest: events carrying the sentinel in every registry field, a frame-shaped stack, a server-owned field, a nested object, an event name, a timestamp and a traceparent",
    emits: ["client.error", "client.warn", "client.info", "session.abandoned"],
    run: async ({ app }, sentinel) => {
      const at = new Date().toISOString();
      const forged = forgedRegistryContext(sentinel);
      const lower = sentinel.toLowerCase();
      const stack = (frame: string) => ({ name: "client.error", at, fields: { errorType: "Error", errorStack: frame } });
      const response = await app.inject({
        method: "POST",
        url: telemetryApi.TELEMETRY_PREFIX,
        payload: {
          events: [
            { name: "client.error", at, fields: forged },
            { name: "client.warn", at, fields: { ...forged, [sentinel]: sentinel, nested: { deep: { sessionId: sentinel } }, list: [sentinel] } },
            { name: "session.abandoned", at, fields: forged, traceparent: sentinel },
            stack(`    at ${sentinel} patient answered yes (x.js:1:1)`),
            stack(`    at Object.${sentinel} (x.js:1:2)`),
            stack(`    at render (http://localhost/${sentinel}.js:1:2)`),
            stack(`    at ${lower} (x.js:1:2)`),
            { name: "client.info", at, fields: { constraint: lower, invariant: `${lower}.answer`, problem: lower, requestId: lower, status: 500 } },
            { name: "session.item_skipped", at, fields: { sessionId: withWhitespace(sentinel), itemId: withWhitespace(sentinel) } },
            { name: sentinel, at, fields: forged },
            { name: sentinel.toLowerCase(), at, fields: forged },
            { name: `client.info ${sentinel}`, at, fields: forged },
            { name: { nested: sentinel }, at, fields: forged },
            { name: "client.info", at: sentinel, fields: forged },
            { name: "client.info", at, fields: sentinel },
            { name: "client.info", at, fields: [sentinel] },
            sentinel,
            [sentinel],
          ],
        },
      });
      expect(response.statusCode, "the planted batch must be accepted for the flow to prove anything").toBe(202);
      expect(response.json(), "the eight events that fail only in their fields or trace are kept, the ten malformed or unknown ones dropped").toEqual({
        accepted: 8,
        dropped: 10,
      });
    },
  },
  {
    name: "telemetry ingest: batches refused as not an envelope, as malformed JSON, as a bare token and as over the size cap, each carrying the sentinel",
    run: async ({ app }, sentinel) => {
      const url = telemetryApi.TELEMETRY_PREFIX;
      const headers = { "content-type": "application/json" };
      const notAnEnvelope = await app.inject({ method: "POST", url, payload: { [sentinel]: sentinel, events: sentinel } });
      const malformed = await app.inject({ method: "POST", url, headers, payload: `{"events": ["${sentinel}` });
      const bareToken = await app.inject({ method: "POST", url, headers, payload: `{"events": ${sentinel}}` });
      const oversized = await app.inject({
        method: "POST",
        url,
        payload: { events: [{ name: "client.info", at: new Date().toISOString(), fields: { text: `${sentinel}${"x".repeat(telemetryApi.MAX_TELEMETRY_BODY_BYTES)}` } }] },
      });
      const plainText = await app.inject({ method: "POST", url, headers: { "content-type": "text/plain" }, payload: sentinel });
      expect([notAnEnvelope, malformed, bareToken, oversized, plainText].map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
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
  {
    name: "reporting: list reads with a real and a forged cursor write no audit row, then a detail read of the stored sentinel answer writes one, without the sentinel",
    emits: ["reporting.responses_listed", "reporting.response_viewed"],
    run: async (world, sentinel) => {
      const sessionId = await submitPlantedResponse(world, sentinel);
      const cursor = encodeCursor({ sort: "started", order: "desc", direction: "forward", sortValue: new Date(Date.now() + 60_000), id: sessionId });
      const listings: Record<string, string>[] = [{}, { cursor }, { cursor: sentinel }];
      for (const query of listings) {
        const listed = await world.app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, query) });
        expect(listed.statusCode, "the planted list read must succeed for the flow to prove anything").toBe(200);
      }
      const viewRows = async () => (await world.testDatabase.readAuditEvents()).filter((event) => event.action === "view_response");
      expect(await viewRows(), "a list read must write no audit row").toEqual([]);

      const detail = await world.app.inject({ method: "GET", url: sessionDetailUrl(INTAKE_QUESTIONNAIRE_ID, sessionId) });
      expect(detail.statusCode).toBe(200);
      expect(detail.body, "the detail read must return the planted answer for the flow to prove anything").toContain(sentinel);
      const views = await viewRows();
      expect(views, "a detail read must write exactly one audit row").toHaveLength(1);
      expect(views[0]).toMatchObject({ questionnaire_id: INTAKE_QUESTIONNAIRE_ID, summary: { sessionId } });
      const stored = JSON.stringify([views, await world.testDatabase.readAuditTraceIds()]).toLowerCase();
      expect(stored, "the audit row must not carry the planted answer").not.toContain(sentinel.toLowerCase());
    },
  },
];
