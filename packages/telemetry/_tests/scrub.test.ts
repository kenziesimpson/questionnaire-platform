import { sensitive } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { scrubAttributes, scrubContext } from "../src/index.js";

const CANARY = "CANARY_DIABETES_8F3A";

describe("scrubContext: only registered fields survive", () => {
  it("maps registered fields to their attribute names", () => {
    const result = scrubContext({ sessionId: "s-1", questionnaireVersion: 2, questionType: "date", outcome: "accepted" });
    expect(result.attributes).toEqual({
      "questionnaire.session_id": "s-1",
      "questionnaire.version": 2,
      "questionnaire.question_type": "date",
      "questionnaire.outcome": "accepted",
    });
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 0 });
  });

  it("drops an unknown field and counts it", () => {
    const result = scrubContext({ sessionId: "s-1", value: CANARY, answer: CANARY });
    expect(result.attributes).toEqual({ "questionnaire.session_id": "s-1" });
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
        "questionnaire.session_id": "s-1",
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
        "questionnaire.session_id": "s-1",
      },
      "span",
    );
    expect(result.attributes).toEqual({ "questionnaire.session_id": "s-1" });
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
      { "questionnaire.question_type": "text", "questionnaire.reason": "answer/required", "questionnaire.session_id": "s-1", "questionnaire.id": "q-1" },
      "metric",
    );
    expect(result.attributes).toEqual({ "questionnaire.question_type": "text", "questionnaire.reason": "answer/required" });
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 2 });
  });

  it("never serializes a value it did not keep", () => {
    const result = scrubAttributes({ secret: CANARY, "http.request.body": sensitive(CANARY), "questionnaire.id": "q-1" }, "span");
    expect(JSON.stringify(result.attributes)).toBe(JSON.stringify({ "questionnaire.id": "q-1" }));
    expect(result.dropped.unknown).toBe(2);
  });
});
