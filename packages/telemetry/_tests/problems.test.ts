import { DRAFT_ITEM_CODES, problem, QUESTION_RULE_CODES, SUBMISSION_ITEM_CODES, type Problem } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { problemTelemetry, scrubContext } from "../src/index.js";
import { PROBLEM_CODES, SCHEMA_CODES } from "../src/problems.js";

const CANARY = "CANARY_DIABETES_8F3A";

function projected(body: Problem) {
  return problemTelemetry(body);
}

describe("problemTelemetry", () => {
  it("projects a problem with no findings to its slug and status", () => {
    expect(projected(problem("questionnaire/closed"))).toEqual([{ problem: "questionnaire/closed", status: 409 }]);
    expect(projected(problem("internal", { detail: "0af7651916cd43dd8448eb211c80319c" }))).toEqual([{ problem: "internal", status: 500 }]);
  });

  it("projects each submission item to its item id and code", () => {
    const body = problem("submission/invalid", {
      items: [
        { itemId: "itm_01", code: "answer/required" },
        { itemId: "itm_02", code: "text/too-long" },
      ],
    });
    expect(projected(body)).toEqual([
      { problem: "submission/invalid", status: 422, itemId: "itm_01", problemCode: "answer/required" },
      { problem: "submission/invalid", status: 422, itemId: "itm_02", problemCode: "text/too-long" },
    ]);
  });

  it("projects each draft item to its item id and code", () => {
    const body = problem("questionnaire/draft-invalid", { items: [{ itemId: "itm_03", code: "predicate/forward-reference" }] });
    expect(projected(body)).toEqual([
      { problem: "questionnaire/draft-invalid", status: 422, itemId: "itm_03", problemCode: "predicate/forward-reference" },
    ]);
  });

  it("projects a request error to its code and never its pointer", () => {
    const body = problem("request/invalid", {
      errors: [
        { pointer: `/body/answers/${CANARY}`, code: "schema/required" },
        { pointer: "/body/question/max", code: "question/min-exceeds-max" },
      ],
    });
    const fields = projected(body);
    expect(fields).toEqual([
      { problem: "request/invalid", status: 400, problemCode: "schema/required" },
      { problem: "request/invalid", status: 400, problemCode: "question/min-exceeds-max" },
    ]);
    expect(JSON.stringify(fields)).not.toContain(CANARY);
  });

  it("maps a schema code outside its known list to schema/other and keeps every other code", () => {
    const body = problem("request/invalid", {
      errors: [
        { pointer: "/body/a", code: "schema/madeUpKeyword" },
        { pointer: "/body/b", code: `schema/${CANARY}` },
        { pointer: "/body/c", code: "schema/other" },
      ],
    });
    expect(projected(body).map((fields) => fields.problemCode)).toEqual(["schema/other", "schema/other", "schema/other"]);
  });

  it("leaves out the item id of answer/unknown-item, which the client chose", () => {
    const body = problem("submission/invalid", {
      items: [
        { itemId: CANARY, code: "answer/unknown-item" },
        { itemId: "itm_01", code: "answer/not-visible" },
      ],
    });
    expect(projected(body)).toEqual([
      { problem: "submission/invalid", status: 422, problemCode: "answer/unknown-item" },
      { problem: "submission/invalid", status: 422, itemId: "itm_01", problemCode: "answer/not-visible" },
    ]);
    expect(JSON.stringify(projected(body))).not.toContain(CANARY);
  });

  it("leaves out a code that is neither known nor a schema code, rather than calling it a schema code", () => {
    const body = problem("request/invalid", { errors: [{ pointer: "/body", code: "question/from-the-future" as "question/type-changed" }] });
    expect(projected(body)).toEqual([{ problem: "request/invalid", status: 400 }]);
  });

  it("never reads title, detail, instance or an extra member of the body", () => {
    const body = {
      ...problem("submission/invalid", { items: [{ itemId: "itm_01", code: "answer/required" }] }),
      title: `title ${CANARY}`,
      detail: `detail ${CANARY}`,
      instance: `/sessions/${CANARY}`,
      value: CANARY,
    };
    expect(JSON.stringify(projected(body))).not.toContain(CANARY);
  });

  it("caps the findings it projects", () => {
    const items = Array.from({ length: 50 }, (_unused, index) => ({ itemId: `itm_${index}`, code: "answer/required" as const }));
    expect(projected(problem("submission/invalid", { items }))).toHaveLength(20);
  });

  it("produces only fields the registry accepts, for every code and a problem of each kind", () => {
    const outcomes: Problem[] = [
      problem("request/invalid", { errors: [...QUESTION_RULE_CODES, ...SCHEMA_CODES].map((code) => ({ pointer: "/body", code })) }),
      problem("questionnaire/draft-invalid", { items: DRAFT_ITEM_CODES.map((code) => ({ itemId: "itm_01", code })) }),
      problem("submission/invalid", { items: SUBMISSION_ITEM_CODES.map((code) => ({ itemId: "itm_01", code })) }),
      problem("internal", { detail: "trace" }),
      problem("resource/not-found"),
      problem("service/unavailable", { detail: "definition" }),
    ];
    for (const body of outcomes) {
      for (const fields of projected(body)) {
        expect(scrubContext(fields).dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 0 });
      }
    }
  });

  it("lists every question rule, draft item, submission item and schema code once", () => {
    expect(new Set(PROBLEM_CODES).size).toBe(PROBLEM_CODES.length);
    expect(PROBLEM_CODES).toEqual(expect.arrayContaining([...QUESTION_RULE_CODES, ...DRAFT_ITEM_CODES, ...SUBMISSION_ITEM_CODES, "schema/other"]));
  });
});

describe("the fields the error and health surfaces add", () => {
  it("accepts an invariant name, a constraint name, a pool and a version id", () => {
    const result = scrubContext({
      invariant: "session.not-marked-submitted",
      constraint: "question_version_pkey",
      pool: "reporting",
      questionnaireVersionId: "0195a3f2-7c1e-7b3a-9d4e-1f2a3b4c5d6e",
    });
    expect(result.attributes).toEqual({
      "questionnaire.version_id": "0195a3f2-7c1e-7b3a-9d4e-1f2a3b4c5d6e",
      "error.invariant": "session.not-marked-submitted",
      "db.constraint": "question_version_pkey",
      "db.pool": "reporting",
    });
    expect(result.dropped).toEqual({ unknown: 0, invalid: 0, unbounded: 0 });
  });

  it("drops free text and a pool outside the closed list", () => {
    const result = scrubContext({
      invariant: `row ${CANARY} is missing`,
      constraint: `Key (answer)=(${CANARY}) already exists`,
      pool: CANARY,
      problem: CANARY,
      problemCode: CANARY,
    });
    expect(result.attributes).toEqual({});
    expect(result.dropped.invalid).toBe(5);
  });
});
