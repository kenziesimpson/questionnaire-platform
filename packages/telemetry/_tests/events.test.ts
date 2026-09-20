import { afterEach, describe, expect, it } from "vitest";
import { emitDomainEvent, type DomainEvent } from "../src/index.js";
import { configureLogging, resetLogging, type LogRecord } from "../src/logger.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "./faults.js";
import { QUESTION_ID, QUESTIONNAIRE_ID, SESSION_ID } from "./fixtures.js";

function forgedEvent(event: DomainEvent, fields: Record<string, unknown>): DomainEvent {
  return Object.assign<DomainEvent, Record<string, unknown>>(event, fields);
}

const written: LogRecord[] = [];

function recordingSink(): void {
  written.length = 0;
  configureLogging({
    level: "debug",
    sink: (record) => {
      written.push(record);
    },
  });
}

function throwingSink(): void {
  configureLogging({
    level: "debug",
    sink: () => {
      throw new Error("sink failed");
    },
  });
}

afterEach(() => {
  resetLogging();
  restoreFaults();
});

describe("emitDomainEvent never throws into the caller", () => {
  it("writes the line and increments the counter when nothing fails", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    emitDomainEvent({ name: "questionnaire.created", questionnaireId: QUESTIONNAIRE_ID });
    expect(written.map((record) => record.message)).toEqual(["questionnaire.created"]);
    expect(recorded).toEqual([{ name: "questionnaire.created", value: 1, attributes: {} }]);
  });

  it("returns normally when the sink throws, still increments the counter, and counts one internal log drop", () => {
    const recorded = installFaultyMeter();
    throwingSink();
    expect(() => {
      emitDomainEvent({ name: "questionnaire.created", questionnaireId: QUESTIONNAIRE_ID });
    }).not.toThrow();
    expect(recorded.filter((entry) => entry.name === "questionnaire.created")).toHaveLength(1);
    expect(internalDropsOf(recorded)).toEqual(["log"]);
  });

  it("returns normally when the counter throws, still writes the line, and counts one internal metric drop", () => {
    const recorded = installFaultyMeter({ failing: ["questionnaire.created"] });
    recordingSink();
    expect(() => {
      emitDomainEvent({ name: "questionnaire.created", questionnaireId: QUESTIONNAIRE_ID });
    }).not.toThrow();
    expect(written).toHaveLength(1);
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("returns normally when the duration histogram throws, and still increments the completion counter", () => {
    const recorded = installFaultyMeter({ failing: ["questionnaire.session.duration"] });
    recordingSink();
    expect(() => {
      emitDomainEvent({ name: "session.completed", sessionId: SESSION_ID, durationMs: 1200, questionCount: 3 });
    }).not.toThrow();
    expect(written).toHaveLength(1);
    expect(recorded.filter((entry) => entry.name === "questionnaire.sessions.completed")).toHaveLength(1);
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("returns normally when getMeter throws", () => {
    installFaultyMeter({ unavailable: true });
    recordingSink();
    expect(() => {
      emitDomainEvent({
        name: "session.answer_rejected",
        sessionId: SESSION_ID,
        itemId: "itm_03",
        questionId: QUESTION_ID,
        reason: "date/in-future",
      });
    }).not.toThrow();
    expect(written).toHaveLength(1);
  });

  it("returns normally, and counts a metric drop, for an event no table entry defines", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    // @ts-expect-error — an event outside the closed table is a compile error; at runtime the lookup must not throw
    expect(() => emitDomainEvent({ name: "custom.event" })).not.toThrow();
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("returns normally when the event object itself throws on read, and counts both signals", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    const event: DomainEvent = { name: "questionnaire.created", questionnaireId: QUESTIONNAIRE_ID };
    const hostile = new Proxy(event, {
      get: () => {
        throw new Error("hostile");
      },
      ownKeys: () => {
        throw new Error("hostile");
      },
    });
    expect(() => {
      emitDomainEvent(hostile);
    }).not.toThrow();
    expect(written).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["log", "metric"]);
  });
});

describe("an event that counts by a payload field", () => {
  const rejected = { name: "session.answers_rejected", sessionId: SESSION_ID, reason: "answer/required" } as const;
  const hostileCounts = [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001, "35", null, [35], { count: 35 }].map((hostile) => [hostile] as const);

  it("adds the field's value to its counter, labelled by the event's labels", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    emitDomainEvent({ ...rejected, findingCount: 35 });
    expect(recorded).toEqual([{ name: "questionnaire.answers.rejected", value: 35, attributes: { "questionnaire.reason": "answer/required" } }]);
    expect(written).toHaveLength(1);
    expect(written[0]?.attributes).toMatchObject({ "questionnaire.finding_count": 35 });
  });

  it("adds one to the counter of an event that names no field to count by, and logs the totals it carries", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    emitDomainEvent({
      name: "questionnaire.publish_finished",
      questionnaireId: QUESTIONNAIRE_ID,
      outcome: "rejected_validation",
      findingCount: 35,
      omittedCount: 15,
    });
    expect(recorded).toEqual([{ name: "questionnaire.publish.total", value: 1, attributes: { "questionnaire.outcome": "rejected_validation" } }]);
    expect(written[0]?.attributes).toMatchObject({ "questionnaire.finding_count": 35, "questionnaire.omitted_count": 15 });
  });

  it("writes a line and moves no counter for an event that is log only", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    emitDomainEvent({ name: "session.answer_rejected", sessionId: SESSION_ID, itemId: "itm_03", questionId: QUESTION_ID, reason: "answer/required" });
    emitDomainEvent({
      name: "questionnaire.publish_rejected",
      questionnaireId: QUESTIONNAIRE_ID,
      itemId: "itm_03",
      problemCode: "predicate/forward-reference",
    });
    expect(written.map((record) => record.message)).toEqual(["session.answer_rejected", "questionnaire.publish_rejected"]);
    expect(recorded).toEqual([]);
  });

  it.each(hostileCounts)("drops a count of %j without throwing, adds nothing to the counter and counts one internal metric drop", (hostile) => {
    const recorded = installFaultyMeter();
    recordingSink();
    expect(() => {
      emitDomainEvent(forgedEvent({ ...rejected, findingCount: 1 }, { findingCount: hostile }));
    }).not.toThrow();
    expect(recorded.filter((entry) => entry.name === "questionnaire.answers.rejected")).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("drops a missing count the same way", () => {
    const recorded = installFaultyMeter();
    recordingSink();
    expect(() => {
      emitDomainEvent(forgedEvent({ ...rejected, findingCount: 1 }, { findingCount: undefined }));
    }).not.toThrow();
    expect(recorded.filter((entry) => entry.name === "questionnaire.answers.rejected")).toEqual([]);
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });

  it("returns normally when the counter throws while adding the count", () => {
    const recorded = installFaultyMeter({ failing: ["questionnaire.answers.rejected"] });
    recordingSink();
    expect(() => {
      emitDomainEvent({ ...rejected, findingCount: 35 });
    }).not.toThrow();
    expect(written).toHaveLength(1);
    expect(internalDropsOf(recorded)).toEqual(["metric"]);
  });
});
