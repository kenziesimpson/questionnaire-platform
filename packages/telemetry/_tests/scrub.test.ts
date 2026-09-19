import { sensitive } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { scrubAttributes, scrubContext } from "../src/index.js";
import { SESSION_ID, QUESTIONNAIRE_ID } from "./fixtures.js";

const CANARY = "CANARY_DIABETES_8F3A";

describe("scrubContext: only registered fields survive", () => {
  it("maps registered fields to their attribute names", () => {
    const result = scrubContext({ sessionId: SESSION_ID, questionnaireVersion: 2, questionType: "date", outcome: "accepted" });
    expect(result.attributes).toEqual({
      "questionnaire.session_id": SESSION_ID,
      "questionnaire.version": 2,
      "questionnaire.question_type": "date",
      "questionnaire.outcome": "accepted",
    });
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 0 });
  });

  it("drops an unknown field and counts it", () => {
    const result = scrubContext({ sessionId: SESSION_ID, value: CANARY, answer: CANARY });
    expect(result.attributes).toEqual({ "questionnaire.session_id": SESSION_ID });
    expect(result.dropped.unknown).toBe(2);
  });

  it("drops a registered field whose value has the wrong shape and counts it", () => {
    const result = scrubContext({
      sessionId: `free text ${CANARY}`,
      questionType: CANARY,
      status: "500",
      questionnaireVersion: Number.NaN,
      itemId: { nested: CANARY },
    });
    expect(result.attributes).toEqual({});
    expect(result.dropped.invalid).toBe(5);
  });

  it("drops a Sensitive value in a registered field", () => {
    const result = scrubContext({ sessionId: sensitive(CANARY) });
    expect(result.attributes).toEqual({});
    expect(result.dropped.invalid).toBe(1);
  });

  it("skips null and undefined without counting them", () => {
    const result = scrubContext({ lastItemId: null, sessionId: undefined });
    expect(result.attributes).toEqual({});
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 0 });
  });

  it("accepts nothing from a non-object", () => {
    expect(scrubContext(CANARY).attributes).toEqual({});
    expect(scrubContext(null).attributes).toEqual({});
  });

  it("does not treat inherited property names as fields", () => {
    const result = scrubContext({ toString: CANARY, constructor: CANARY });
    expect(result.attributes).toEqual({});
    expect(result.dropped.unknown).toBe(2);
  });
});

describe("scrubAttributes: the exporter allowlist", () => {
  it("keeps registered attributes and known infrastructure attributes", () => {
    const result = scrubAttributes(
      {
        "questionnaire.session_id": SESSION_ID,
        "http.route": "/questionnaires/:questionnaireId",
        "http.response.status_code": 200,
        "db.system": "postgresql",
        trace_id: "0123456789abcdef0123456789abcdef",
      },
      "span",
    );
    expect(Object.keys(result.attributes).sort()).toEqual([
      "db.system",
      "http.response.status_code",
      "http.route",
      "questionnaire.session_id",
      "trace_id",
    ]);
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 0 });
  });

  it("drops attributes a third-party instrumentation attaches and counts them", () => {
    const result = scrubAttributes(
      {
        "url.path": `/sessions/${CANARY}`,
        "url.full": `http://x/sessions/${CANARY}`,
        "http.request.body": CANARY,
        "db.statement": `select ${CANARY}`,
        "exception.message": CANARY,
        "questionnaire.session_id": SESSION_ID,
      },
      "span",
    );
    expect(result.attributes).toEqual({ "questionnaire.session_id": SESSION_ID });
    expect(result.dropped.unknown).toBe(5);
  });

  it("drops a registered attribute whose value is free text or the wrong type", () => {
    const result = scrubAttributes(
      { "questionnaire.session_id": `two words ${CANARY}`, "http.route": "no-leading-slash", "db.system": 7 },
      "span",
    );
    expect(result.attributes).toEqual({});
    expect(result.dropped.invalid).toBe(3);
  });

  it("drops arrays, objects and Sensitive values even under a registered key", () => {
    const result = scrubAttributes(
      { "questionnaire.item_id": [CANARY], "questionnaire.question_id": { a: CANARY }, "questionnaire.id": sensitive(CANARY) },
      "log",
    );
    expect(result.attributes).toEqual({});
    expect(result.dropped.invalid).toBe(3);
  });

  it("keeps only bounded dimensions on a metric and counts the rest as unbounded", () => {
    const result = scrubAttributes(
      { "questionnaire.question_type": "text", "questionnaire.reason": "answer/required", "questionnaire.session_id": SESSION_ID, "questionnaire.id": QUESTIONNAIRE_ID },
      "metric",
    );
    expect(result.attributes).toEqual({ "questionnaire.question_type": "text", "questionnaire.reason": "answer/required" });
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 2 });
  });

  it("never serializes a value it did not keep", () => {
    const result = scrubAttributes({ secret: CANARY, "http.request.body": sensitive(CANARY), "questionnaire.id": QUESTIONNAIRE_ID }, "span");
    expect(JSON.stringify(result.attributes)).toBe(JSON.stringify({ "questionnaire.id": QUESTIONNAIRE_ID }));
    expect(result.dropped.unknown).toBe(2);
  });
});

const LONG = "a".repeat(200);

const SHAPES: readonly {
  readonly field: string;
  readonly accepts: readonly string[];
  readonly rejects: readonly string[];
}[] = [
  ...["sessionId", "questionnaireId", "questionnaireVersionId", "questionId", "requestId"].map((field) => ({
    field,
    accepts: [SESSION_ID, SESSION_ID.toUpperCase(), "0195a3f2-7c1e-7b3a-9d4e-1f2a3b4c5d6e"],
    rejects: ["diabetes", "s-1", "type-2-diabetes", "2026-01-01", "12345", CANARY, `${SESSION_ID} `, `${SESSION_ID}\n`, SESSION_ID.replaceAll("-", "")],
  })),
  ...["itemId", "lastItemId"].map((field) => ({
    field,
    accepts: ["diabetes", "itm_01", "q1"],
    rejects: ["Diabetes", "type-2", "2026-01-01", "12345", "1st_item", CANARY, SESSION_ID, "two words", "a".repeat(65), "item\n"],
  })),
  {
    field: "route",
    accepts: ["/", "/health", "/health/live", "/api/run/sessions/:sessionId", "/api/run/sessions/:sessionId/", "/questionnaires/$questionnaireId/responses", "/a/{id}/b", "/files/*", "/v1.2/items"],
    rejects: ["", "sessions", "//", "/x?answer=1", "/x#y", "/Diabetes", `/${CANARY}`, "/a b", "/a//b", "/:", "/a/:1", "/a/:b-c", `/${LONG}`, "/x\n"],
  },
  {
    field: "errorType",
    accepts: ["Error", "TypeError", "InvariantViolation", "DrizzleQueryError", "AbortError"],
    rejects: ["diabetes", "type-2", CANARY, "Error: x", "two words", "", "Error\n", `E${LONG}`],
  },
  {
    field: "errorCode",
    accepts: ["23505", "QP001", "42501", "23514"],
    rejects: ["diabetes", "2301", "230505", "qp001", "FST_ERR_X", CANARY, "2350 ", "abcde"],
  },
  {
    field: "constraint",
    accepts: ["response_pkey", "qv_addressable", "session_state", "question_version_option_question_version_fk"],
    rejects: ["diabetes", "type-2", "Response_pkey", "_pkey", "response_", CANARY, "a b_c", "a_b\n", `a_${"b".repeat(63)}`],
  },
  {
    field: "invariant",
    accepts: ["session.not-marked-submitted", "author.read-outside-author-hook", "audit.record-returned-no-id"],
    rejects: ["diabetes", "type-2-diabetes", "2026-01-01", "a.", ".a", "Session.x", "a_b.c", CANARY, "a.b c", `a.${"b".repeat(64)}`],
  },
];

describe("scrubContext: every token-shaped field rejects what an answer looks like", () => {
  it.each(SHAPES.flatMap(({ field, accepts }) => accepts.map((value) => [field, value] as const)))("%s keeps %j", (field, value) => {
    const result = scrubContext({ [field]: value });

    expect(Object.values(result.attributes)).toEqual([value]);
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 0 });
  });

  it.each(SHAPES.flatMap(({ field, rejects }) => rejects.map((value) => [field, value] as const)))("%s drops %j", (field, value) => {
    const result = scrubContext({ [field]: value });

    expect(result.attributes).toEqual({});
    expect(result.dropped.invalid).toBe(1);
  });
});

describe("scrubAttributes: the logger's module name is one of a closed list", () => {
  it.each(["backend", "definition", "events", "execution", "http"])("keeps module %s", (module) => {
    expect(scrubAttributes({ module }, "log").attributes).toEqual({ module });
  });

  it.each(["diabetes", "canary", "Http", CANARY, "type-2", ""])("drops module %j", (module) => {
    const result = scrubAttributes({ module }, "log");

    expect(result.attributes).toEqual({});
    expect(result.dropped.invalid).toBe(1);
  });
});
