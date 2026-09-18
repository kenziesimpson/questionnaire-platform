import { type ClientAnswers } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPartialAnswers,
  partialsKey,
  PARTIALS_FORMAT_VERSION,
  readPartials,
  removePartials,
  writePartials,
} from "../../src/storage/partials";
import { ANSWER_SENTINEL, OTHER_QUESTIONNAIRE_ID, SESSION_ID } from "../fixtures";

const session = { sessionId: SESSION_ID, questionnaireId: INTAKE_QUESTIONNAIRE_ID };
const key = `qp:respondent:${INTAKE_QUESTIONNAIRE_ID}`;
const now = new Date("2026-09-14T09:05:00.000Z");

const answersWithHiddenBranch: ClientAnswers = {
  itm_01: { type: "single_choice", optionId: "no" },
  itm_02: { type: "single_choice", optionId: "other", otherText: ANSWER_SENTINEL },
  itm_03: { type: "date", date: "2019-04-02" },
  itm_04: null,
};

const validEnvelope = {
  formatVersion: PARTIALS_FORMAT_VERSION,
  sessionId: SESSION_ID,
  questionnaireId: INTAKE_QUESTIONNAIRE_ID,
  answers: answersWithHiddenBranch,
  updatedAt: now.toISOString(),
};

function store(value: unknown) {
  localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("partials storage", () => {
  it("keys partials by questionnaire as qp:respondent:<questionnaireId>", () => {
    expect(partialsKey(INTAKE_QUESTIONNAIRE_ID)).toBe(key);
  });

  it("round-trips the envelope, including answers to hidden items", () => {
    writePartials(session, answersWithHiddenBranch, now);

    expect(JSON.parse(localStorage.getItem(key) ?? "")).toEqual(validEnvelope);
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toEqual(validEnvelope);
  });

  it("reads nothing when nothing is stored", () => {
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
  });

  it("discards unparseable JSON without throwing", () => {
    store("{not json");

    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
  });

  it.each([2, 0, "1"])("discards an envelope with formatVersion %j", (formatVersion) => {
    store({ ...validEnvelope, formatVersion });

    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["a string", "answers"],
    ["an array", [validEnvelope]],
    ["an empty object", {}],
    ["no sessionId", { ...validEnvelope, sessionId: undefined }],
    ["a sessionId that is not a uuid", { ...validEnvelope, sessionId: "session-1" }],
    ["answers that are not an object", { ...validEnvelope, answers: [] }],
    ["an answer key that is not an item id", { ...validEnvelope, answers: { "Item 1": null } }],
    ["an updatedAt that is not a timestamp", { ...validEnvelope, updatedAt: "yesterday" }],
    ["an extra field", { ...validEnvelope, definition: {} }],
    ["another questionnaire's id", { ...validEnvelope, questionnaireId: OTHER_QUESTIONNAIRE_ID }],
  ])("discards a foreign shape: %s", (_label, value) => {
    store(value);

    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
  });

  it("drops a stored answer that is not a valid answer, such as a half-typed number, and keeps the rest", () => {
    store({ ...validEnvelope, answers: { ...answersWithHiddenBranch, itm_05: { type: "number", value: "72." }, itm_06: { type: "banana" } } });

    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toEqual(validEnvelope);
  });

  it("clears the answers after submit and keeps the session and questionnaire ids", () => {
    writePartials(session, answersWithHiddenBranch, now);
    const clearedAt = new Date("2026-09-14T09:12:00.000Z");

    clearPartialAnswers(session, clearedAt);

    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toEqual({ ...validEnvelope, answers: {}, updatedAt: clearedAt.toISOString() });
    expect(localStorage.getItem(key)).not.toContain(ANSWER_SENTINEL);
  });

  it("removes the entry entirely and leaves other questionnaires alone", () => {
    writePartials(session, answersWithHiddenBranch, now);
    writePartials({ sessionId: SESSION_ID, questionnaireId: OTHER_QUESTIONNAIRE_ID }, {}, now);

    removePartials(INTAKE_QUESTIONNAIRE_ID);

    expect(localStorage.getItem(key)).toBeNull();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
    expect(readPartials(OTHER_QUESTIONNAIRE_ID)).toEqual({ ...validEnvelope, questionnaireId: OTHER_QUESTIONNAIRE_ID, answers: {} });
  });

  it("tolerates a localStorage whose every operation throws", () => {
    writePartials(session, answersWithHiddenBranch, now);
    const denied = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(denied);

    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
    expect(() => writePartials(session, answersWithHiddenBranch, now)).not.toThrow();
    expect(() => clearPartialAnswers(session, now)).not.toThrow();
    expect(() => removePartials(INTAKE_QUESTIONNAIRE_ID)).not.toThrow();
  });

  it("keeps the last stored envelope when a write exceeds the quota", () => {
    writePartials(session, answersWithHiddenBranch, now);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(() => writePartials(session, {}, new Date("2026-09-14T09:06:00.000Z"))).not.toThrow();
    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toEqual(validEnvelope);
  });

  it("tolerates localStorage being absent", () => {
    writePartials(session, answersWithHiddenBranch, now);
    vi.stubGlobal("localStorage", undefined);

    expect(readPartials(INTAKE_QUESTIONNAIRE_ID)).toBeUndefined();
    expect(() => writePartials(session, answersWithHiddenBranch, now)).not.toThrow();
    expect(() => clearPartialAnswers(session, now)).not.toThrow();
    expect(() => removePartials(INTAKE_QUESTIONNAIRE_ID)).not.toThrow();
  });
});
