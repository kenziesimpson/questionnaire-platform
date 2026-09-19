import { describe, expect, it } from "vitest";
import { emitDomainEvent, logger, withSpan } from "../src/index.js";

const log = logger("definition");

describe("telemetry boundary signature", () => {
  it("accepts literal messages with closed context", async () => {
    log.info("session submitted", { sessionId: "s", questionnaireVersion: 2, outcome: "accepted" });
    log.error("submit failed", { status: 500, route: "/sessions/:sessionId/submit", errorType: "Error" }, new Error("x"));
    emitDomainEvent({ name: "session.answer_rejected", sessionId: "s", itemId: "itm_03", questionId: "q", reason: "date/in-future" });
    await expect(withSpan("session.submit", { sessionId: "s" }, async () => 42)).resolves.toBe(42);
  });

  it("offers debug, info, warn and error and no fatal", () => {
    expect(Object.keys(log).sort()).toEqual(["debug", "error", "info", "warn"]);
  });

  it("refuses the shapes an answer value could ride in on", () => {
    const answer = "CANARY_DIABETES_8F3A" as string;
    // @ts-expect-error — an interpolated message is a pattern type, not a literal
    log.warn(`rejected ${answer}`);
    // @ts-expect-error — nor is a message held in a `string` variable
    log.warn(answer);
    // @ts-expect-error — nor is a module name held in a `string` variable
    logger(answer);
    // @ts-expect-error — context is a closed field set
    log.info("answer received", { sessionId: "s", value: answer });
    // @ts-expect-error — a field's value has the field's type: a status is a number
    log.info("answered", { status: answer });
    // @ts-expect-error — a closed enum takes its members, not any string
    log.info("answered", { questionType: answer });
    // @ts-expect-error — a log call has no fatal level
    expect(() => log.fatal("boom")).toThrow(TypeError);
    // @ts-expect-error — domain events carry codes, never values
    emitDomainEvent({ name: "session.answer_rejected", sessionId: "s", itemId: "i", questionId: "q", reason: answer });
    // @ts-expect-error — span names are closed
    void withSpan("custom.span", {}, async () => undefined);
    expect(true).toBe(true);
  });
});
