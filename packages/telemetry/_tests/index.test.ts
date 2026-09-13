import { describe, expect, it } from "vitest";
import { emitDomainEvent, log, withSpan } from "../src/index.js";

describe("telemetry boundary signature", () => {
  it("accepts literal messages with closed context", async () => {
    log("info", "session submitted", { sessionId: "s", questionnaireVersion: 2, outcome: "accepted" });
    emitDomainEvent({ name: "session.answer_rejected", sessionId: "s", itemId: "itm_03", questionId: "q", reason: "date/in-future" });
    await expect(withSpan("session.submit", { sessionId: "s" }, async () => 42)).resolves.toBe(42);
  });

  it("refuses the shapes an answer value could ride in on", () => {
    const answer = "CANARY_DIABETES_8F3A" as string;
    // @ts-expect-error — an interpolated message is a pattern type, not a literal
    log("warn", `rejected ${answer}`);
    // @ts-expect-error — nor is a message held in a `string` variable
    log("warn", answer);
    // @ts-expect-error — context is a closed field set
    log("info", "answer received", { sessionId: "s", value: answer });
    // @ts-expect-error — domain events carry codes, never values
    emitDomainEvent({ name: "session.answer_rejected", sessionId: "s", itemId: "i", questionId: "q", reason: answer });
    // @ts-expect-error — span names are closed
    void withSpan("custom.span", {}, async () => undefined);
    expect(true).toBe(true);
  });
});
