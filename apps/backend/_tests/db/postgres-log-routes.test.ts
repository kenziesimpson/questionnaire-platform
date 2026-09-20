import { randomBytes, randomUUID } from "node:crypto";
import { INTAKE_ITEM_IDS, INTAKE_OPTION_IDS, INTAKE_QUESTION_IDS, INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { requestLogger } from "../../src/http/request-logger.js";
import { definitionUrl } from "../modules/definition/fixtures.js";
import { answersYes, executionUrl, seedIntakeV1, startedSessionId, submit } from "../modules/execution/fixtures.js";
import { listSessionsUrl, sessionDetailUrl } from "../modules/reporting/fixtures.js";
import { useTestDatabase } from "./harness.js";
import { failureOf, linesMentioning, postgresServerLogPath, readPostgresLogAfterBarrier, uniqueToken } from "./postgres-log.js";

const testDatabase = useTestDatabase();

const serverLogCaptured = postgresServerLogPath() !== undefined;

const INT4_LIMIT = 2_147_483_648;

const PROBE_PATH = "/postgres-log-probe";

let telemetry: TestTelemetry;
let app: FastifyInstance;

beforeAll(async () => {
  telemetry = installTestTelemetry({ logLevel: "error", autoInstrumentation: true, loadedDatabaseDriver: pg });
  app = await buildApp({
    logger: requestLogger("error"),
    definition: { database: testDatabase.database("definition") },
    execution: { database: testDatabase.database("execution") },
    reporting: { reporting: testDatabase.database("reporting") },
  });
  app.get(PROBE_PATH, async () => {
    const failure = await testDatabase
      .pool("execution")
      .query("SELECT $1::integer", ["not-a-number"])
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    return { failed: failure instanceof Error };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await telemetry.shutdown();
});

interface Attempt {
  readonly label: string;
  readonly token: string;
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  readonly payload?: object;
  readonly headers?: Record<string, string>;
  readonly refused: boolean;
}

function attempt(
  label: string,
  build: (token: string) => Pick<Attempt, "method" | "url" | "payload" | "headers">,
  refused = true,
  token = uniqueToken(),
): Attempt {
  return { label, token, refused, ...build(token) };
}

const NUL = String.fromCharCode(0);

function digits(count: number): string {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 10)).join("");
}

function year(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function monthAndDay(months: readonly string[]): string {
  const month = months[Math.floor(Math.random() * months.length)] ?? "01";
  return `${month}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;
}

const ROUTE_MONTHS_OF_YEAR_ZERO = ["01", "02", "03", "04", "05", "06"];

const CONTROL_MONTHS_OF_YEAR_ZERO = ["07", "08", "09", "10", "11", "12"];

function fraction(): string {
  return `.${digits(12)}`;
}

function encodedCursor(token: string): string {
  return Buffer.from(`forward|started|desc|${token}|${token}`, "utf8").toString("base64url");
}

function outOfRangeInteger(index: number): number {
  return INT4_LIMIT + index * 1_000_000 + Math.floor(Math.random() * 999_999);
}

function typedColumnAttempts(sessionId: string): Attempt[] {
  const int4 = (index: number) => String(outOfRangeInteger(index));
  const submitDate = (date: string) => ({
    method: "POST" as const,
    url: executionUrl(`/sessions/${sessionId}/submit`),
    payload: { answers: { [INTAKE_ITEM_IDS.diagnosedOn]: { type: "date", date } } },
  });
  const closesAt = (value: string) => ({
    method: "PUT" as const,
    url: definitionUrl(`/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/closes-at`),
    payload: { closesAt: value },
  });
  const withNul = (token: string) => `${token}${NUL}`;
  return [
    attempt("a version filter above the int4 maximum", (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { version: token }) }), true, int4(1)),
    attempt(
      "a published version above the int4 maximum",
      (token) => ({ method: "GET", url: definitionUrl(`/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/versions/${token}`) }),
      true,
      int4(2),
    ),
    attempt(
      "a question version above the int4 maximum",
      (token) => ({ method: "GET", url: definitionUrl(`/questions/${INTAKE_QUESTION_IDS.pharmacy}/versions/${token}`) }),
      true,
      int4(3),
    ),
    attempt(
      "a draft item's question version above the int4 maximum",
      (token) => ({
        method: "PUT",
        url: definitionUrl(`/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/draft`),
        headers: { "if-match": `W/"${randomUUID()}:0"` },
        payload: {
          title: "Fixture",
          items: [{ itemId: "itm_01", required: false, visibleWhen: null, questionId: INTAKE_QUESTION_IDS.pharmacy, questionVersion: Number(token) }],
        },
      }),
      true,
      int4(4),
    ),
    attempt("a date answer in the year 0000", (token) => submitDate(token), true, `0000-${monthAndDay(ROUTE_MONTHS_OF_YEAR_ZERO)}`),
    attempt("a date answer that is not a calendar day", (token) => submitDate(token), true, `${year()}-02-30`),
    attempt("a date answer with a month of 13", (token) => submitDate(token), true, `${year()}-13-${monthAndDay(["01"]).slice(3)}`),
    attempt("a date answer in the year 10000", (token) => submitDate(token), true, `1${digits(5)}-01-02`),
    attempt(
      "a decimal answer longer than 64 characters",
      (token) => ({
        method: "POST",
        url: executionUrl(`/sessions/${sessionId}/submit`),
        payload: { answers: { [INTAKE_ITEM_IDS.pharmacy]: { type: "number", value: token } } },
      }),
      true,
      `9${digits(64)}`,
    ),
    attempt("a close time in the year 0000", (token) => closesAt(token), true, `0000-${monthAndDay(ROUTE_MONTHS_OF_YEAR_ZERO)}T00:00:00${fraction()}Z`),
    attempt("a close time that is not a calendar day", (token) => closesAt(token), true, `${year()}-02-30T00:00:00${fraction()}Z`),
    attempt("a close time with a leap second", (token) => closesAt(token), true, `${year()}-06-30T23:59:60${fraction()}Z`),
    attempt("a text answer with a null character", (token) => ({
      method: "POST",
      url: executionUrl(`/sessions/${sessionId}/submit`),
      payload: { answers: { [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: withNul(token) } } },
    })),
    attempt("an other text with a null character", (token) => ({
      method: "POST",
      url: executionUrl(`/sessions/${sessionId}/submit`),
      payload: {
        answers: {
          [INTAKE_ITEM_IDS.whichCondition]: { type: "single_choice", optionId: INTAKE_OPTION_IDS.other, otherText: withNul(token) },
        },
      },
    })),
    attempt("a questionnaire title with a null character", (token) => ({
      method: "POST",
      url: definitionUrl("/questionnaires"),
      payload: { name: "Fixture", title: withNul(token) },
    })),
    attempt("a question prompt with a null character", (token) => ({
      method: "POST",
      url: definitionUrl("/questions"),
      payload: { question: { type: "text", prompt: withNul(token) } },
    })),
    attempt("an option label with a null character", (token) => ({
      method: "POST",
      url: definitionUrl("/questions"),
      payload: { question: { type: "single_choice", prompt: "Which", options: [{ optionId: "yes", label: withNul(token) }] } },
    })),
  ];
}

async function plantedSession(): Promise<string> {
  await seedIntakeV1(testDatabase);
  return startedSessionId(app);
}

describe.skipIf(!serverLogCaptured)("the Postgres server log, and the values that reach the database through the real routes (docs/6 §14.1)", () => {
  it("holds a questionnaire title, a question prompt and an answer that were stored and read back, in none of its lines", async () => {
    const token = uniqueToken();
    const question = await app.inject({ method: "POST", url: definitionUrl("/questions"), payload: { question: { type: "text", prompt: token } } });
    const questionnaire = await app.inject({ method: "POST", url: definitionUrl("/questionnaires"), payload: { name: token, title: token } });
    expect([question.statusCode, questionnaire.statusCode], "the planted prompt and title must be stored").toEqual([201, 201]);
    const sessionId = await plantedSession();
    const submitted = await submit(
      app,
      sessionId,
      answersYes({
        [INTAKE_ITEM_IDS.whichCondition]: { type: "single_choice", optionId: INTAKE_OPTION_IDS.other, otherText: token },
        [INTAKE_ITEM_IDS.pharmacy]: { type: "text", text: token },
      }),
    );
    expect(submitted.statusCode, "the planted answer must be accepted").toBe(200);
    const stored = await (await testDatabase.connect("owner")).query<{ text_value: string | null; other_text: string | null }>(
      "SELECT text_value, other_text FROM execution.response WHERE session_id = $1",
      [sessionId],
    );
    expect(stored.rows.map((row) => row.text_value ?? row.other_text)).toEqual(expect.arrayContaining([token]));
    const listed = await app.inject({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID) });
    const detail = await app.inject({ method: "GET", url: sessionDetailUrl(INTAKE_QUESTIONNAIRE_ID, sessionId) });
    expect([listed.statusCode, detail.statusCode]).toEqual([200, 200]);
    expect(detail.body, "the read-back must return the planted answer").toContain(token);

    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(linesMentioning(log, token)).toEqual([]);
  });

  it("holds no malformed id, cursor, version, date, decimal, timestamp, header or body field the routes refused, because request validation runs before a value is bound", async () => {
    const sessionId = await plantedSession();
    const otherSession = randomUUID();
    const attempts: Attempt[] = [
      attempt("a session id in the run path", (token) => ({ method: "GET", url: executionUrl(`/sessions/${token}`) })),
      attempt("a questionnaire id in the start body", (token) => ({ method: "POST", url: executionUrl("/sessions"), payload: { questionnaireId: token } })),
      attempt("a session id in the submit path", (token) => ({
        method: "POST",
        url: executionUrl(`/sessions/${token}/submit`),
        payload: { answers: {} },
      })),
      attempt("a date answer that is not a date", (token) => ({
        method: "POST",
        url: executionUrl(`/sessions/${sessionId}/submit`),
        payload: { answers: { [INTAKE_ITEM_IDS.diagnosedOn]: { type: "date", date: token } } },
      })),
      attempt("an option id in a choice answer", (token) => ({
        method: "POST",
        url: executionUrl(`/sessions/${sessionId}/submit`),
        payload: { answers: { [INTAKE_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: token } } },
      })),
      attempt("a number answer that is not a decimal", (token) => ({
        method: "POST",
        url: executionUrl(`/sessions/${otherSession}/submit`),
        payload: { answers: { [INTAKE_ITEM_IDS.pharmacy]: { type: "number", value: token } } },
      })),
      attempt("an item key the questionnaire does not have", (token) => ({
        method: "POST",
        url: executionUrl(`/sessions/${sessionId}/submit`),
        payload: { answers: { [token.toLowerCase()]: { type: "text", text: "x" } } },
      })),
      attempt("a questionnaire id in the responses list path", (token) => ({ method: "GET", url: listSessionsUrl(token) })),
      attempt("a cursor that is not a cursor", (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { cursor: token }) }), false),
      attempt(
        "a cursor whose fields are the token",
        (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { cursor: encodedCursor(token) }) }),
        false,
      ),
      attempt(
        "a cursor with a real shape and a session id that is not a uuid",
        (token) => ({
          method: "GET",
          url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, {
            cursor: Buffer.from(`forward|started|desc|${new Date().toISOString()}|${token}`, "utf8").toString("base64url"),
          }),
        }),
        false,
      ),
      attempt("a version filter that is not a number", (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { version: token }) })),
      attempt("a status filter outside the closed list", (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { status: token }) })),
      attempt("a sort outside the closed list", (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { sort: token }) })),
      attempt("an order outside the closed list", (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { order: token }) })),
      attempt("a query parameter the route does not take", (token) => ({ method: "GET", url: listSessionsUrl(INTAKE_QUESTIONNAIRE_ID, { answer: token }) })),
      attempt("a session id in the response detail path", (token) => ({ method: "GET", url: sessionDetailUrl(INTAKE_QUESTIONNAIRE_ID, token) })),
      attempt("a questionnaire id in the response detail path", (token) => ({ method: "GET", url: sessionDetailUrl(token, sessionId) })),
      attempt("a questionnaire id in the draft path", (token) => ({ method: "GET", url: definitionUrl(`/questionnaires/${token}/draft`) })),
      attempt("a version in the published version path", (token) => ({
        method: "GET",
        url: definitionUrl(`/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/versions/${token}`),
      })),
      attempt("a question id in the question path", (token) => ({ method: "GET", url: definitionUrl(`/questions/${token}`) })),
      attempt("a version in the question version path", (token) => ({
        method: "GET",
        url: definitionUrl(`/questions/${INTAKE_QUESTION_IDS.pharmacy}/versions/${token}`),
      })),
      attempt("an If-Match header on a draft save", (token) => ({
        method: "PUT",
        url: definitionUrl(`/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/draft`),
        headers: { "if-match": token },
        payload: { title: "Fixture", items: [] },
      })),
      attempt("a question id in a draft item", (token) => ({
        method: "PUT",
        url: definitionUrl(`/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/draft`),
        headers: { "if-match": `W/"${randomUUID()}:0"` },
        payload: { title: "Fixture", items: [{ itemId: "itm_01", required: false, visibleWhen: null, questionId: token, questionVersion: 1 }] },
      })),
      attempt("a close time that is not a date", (token) => ({
        method: "PUT",
        url: definitionUrl(`/questionnaires/${INTAKE_QUESTIONNAIRE_ID}/closes-at`),
        payload: { closesAt: token },
      })),
      attempt("a key outside the slug shape", (token) => ({
        method: "POST",
        url: definitionUrl("/questionnaires"),
        payload: { name: "Fixture", title: "Fixture", key: token },
      })),
      ...typedColumnAttempts(sessionId),
    ];

    const statuses: { label: string; status: number }[] = [];
    for (const each of attempts) {
      const response = await app.inject({
        method: each.method,
        url: each.url,
        ...(each.payload === undefined ? {} : { payload: each.payload }),
        ...(each.headers === undefined ? {} : { headers: each.headers }),
      });
      statuses.push({ label: each.label, status: response.statusCode });
    }
    const log = await readPostgresLogAfterBarrier(testDatabase);

    const notRefusedAtTheEdge = statuses.filter((entry, index) => entry.status >= 500 || (attempts[index]?.refused === true && entry.status < 400));
    expect(notRefusedAtTheEdge, "a request must be answered as the client's error and not reach the database as a failure").toEqual([]);
    expect(attempts.filter((each) => log.includes(each.token)).map((each) => each.label)).toEqual([]);
  });

  it("control: an integer above int4 sent to Postgres over a pooled connection is in the ERROR line, so the routes above are refused before it can be", async () => {
    const value = outOfRangeInteger(9);
    const client = await testDatabase.connect("execution");

    const failure = await failureOf(client, "SELECT id FROM execution.session WHERE version = $1", [String(value)]);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(failure.message).toContain(String(value));
    expect(linesMentioning(log, String(value)).some((line) => line.includes("ERROR:") && line.includes("out of range for type integer"))).toBe(true);
  });

  it("control: a date in the year 0000 sent to Postgres over a pooled connection is in the ERROR line, so the routes above are refused before it can be", async () => {
    const value = `0000-${monthAndDay(CONTROL_MONTHS_OF_YEAR_ZERO)}`;
    const client = await testDatabase.connect("execution");

    const failure = await failureOf(client, "SELECT $1::date", [value]);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(failure.message).toContain(value);
    expect(linesMentioning(log, `"${value}"`).some((line) => line.includes("ERROR:") && line.includes("date/time field value out of range"))).toBe(true);
  });

  it("control: a calendar-invalid timestamp sent to Postgres over a pooled connection is in the ERROR line, so the close-time routes above are refused before it can be", async () => {
    const value = `${year()}-02-30T00:00:00${fraction()}Z`;
    const client = await testDatabase.connect("execution");

    const failure = await failureOf(client, "SELECT $1::timestamptz", [value]);
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(failure.message).toContain(value);
    expect(linesMentioning(log, `"${value}"`).some((line) => line.includes("ERROR:") && line.includes("date/time field value out of range"))).toBe(true);
  });

  it("control: the Invalid Date a leap second makes is an error when Postgres is handed it, so the close-time routes above are refused before a 500", async () => {
    const client = await testDatabase.connect("execution");

    const failure = await failureOf(client, "SELECT $1::timestamptz", [new Date("2031-06-30T23:59:60Z")]);

    expect(failure.code).toBe("22007");
  });

  it("control: a decimal beyond what numeric can hold is an error when sent to Postgres, so the length bound is what keeps a long one from being a 500", async () => {
    const client = await testDatabase.connect("execution");

    const failure = await failureOf(client, "SELECT $1::numeric", ["9".repeat(131_073)]);

    expect(failure.code).toBe("22003");
  });

  it("control: a null character sent to Postgres over a pooled connection is an error, so validation is what keeps it from being a 500", async () => {
    const client = await testDatabase.connect("execution");

    const failure = await failureOf(client, "SELECT $1::text", [`before${NUL}after`]);

    expect(failure.code).toBe("22021");
  });

  it("carries the trace context of the statement in the STATEMENT line, and no tracestate a caller sent", async () => {
    const traceId = randomBytes(16).toString("hex");
    const callerSpanId = randomBytes(8).toString("hex");
    const hostile = uniqueToken();

    const response = await app.inject({
      method: "GET",
      url: PROBE_PATH,
      headers: { traceparent: `00-${traceId}-${callerSpanId}-01`, tracestate: `vendor=${hostile}` },
    });
    const log = await readPostgresLogAfterBarrier(testDatabase);

    expect(response.json()).toEqual({ failed: true });
    const statements = linesMentioning(log, traceId).filter((line) => line.includes("STATEMENT:"));
    expect(statements, "the failed statement must be in the log with its trace context").toHaveLength(1);
    const comment = new RegExp(`SELECT \\$1::integer /\\*traceparent='00-${traceId}-([0-9a-f]{16})-01'\\*/$`).exec(statements[0] ?? "");
    expect(comment, "the statement's comment holds traceparent alone").not.toBeNull();
    const statementSpan = telemetry.spans().find((span) => span.spanContext().spanId === comment?.[1]);
    expect(statementSpan?.spanContext().traceId, "the span in the log line is a span of the caller's trace").toBe(traceId);
    expect(statementSpan?.name).toBe("pg.query:SELECT");
    expect(linesMentioning(log, hostile)).toEqual([]);
    expect(statements[0]).not.toContain("tracestate");
  });
});
