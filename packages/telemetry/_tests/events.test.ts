import { afterEach, describe, expect, it } from "vitest";
import { emitDomainEvent, type DomainEvent } from "../src/index.js";
import { configureLogging, resetLogging, type LogRecord } from "../src/logger.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "./faults.js";
import { QUESTION_ID, QUESTIONNAIRE_ID, SESSION_ID } from "./fixtures.js";

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
