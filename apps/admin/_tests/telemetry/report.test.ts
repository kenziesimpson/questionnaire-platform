import { problem } from "@qp/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ProblemError, UnexpectedResponseError } from "../../src/api/problem-error";
import { reportMutationFailure, reportQueryFailure } from "../../src/telemetry/report";
import { routedQueue } from "../support/telemetry";

const ANSWER_SENTINEL = "SENTINEL-answer-value-9c4d";

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function routed() {
  const queue = routedQueue();
  stops.push(queue.stop);
  return queue;
}

const internal = () => new ProblemError("internal", 500, problem("internal", { detail: ANSWER_SENTINEL }));

describe("reportQueryFailure and reportMutationFailure", () => {
  it.each([
    ["a network failure", () => new TypeError(ANSWER_SENTINEL), "TypeError"],
    ["a 500 problem", internal, "ProblemError"],
    ["a response that is not a problem", () => new UnexpectedResponseError(502, ANSWER_SENTINEL), "UnexpectedResponseError"],
  ])("queues one client warning naming the error's class and frames, and never its message, for %s", (_case, build, name) => {
    const { flush } = routed();

    reportQueryFailure(build());
    const events = flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: "warn", message: "query failed", attributes: { "error.type": name } });
    expect(events[0]?.attributes["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(events)).not.toContain(ANSWER_SENTINEL);
  });

  it("reports a failed mutation the same way, under its own message", () => {
    const { flush } = routed();

    reportMutationFailure(internal());
    const events = flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: "warn", message: "mutation failed", attributes: { "error.type": "ProblemError" } });
    expect(JSON.stringify(events)).not.toContain(ANSWER_SENTINEL);
  });

  it.each([
    ["a 404 problem", new ProblemError("resource/not-found", 404, problem("resource/not-found", { instance: ANSWER_SENTINEL }))],
    ["a 409 problem", new ProblemError("questionnaire/draft-stale", 409, problem("questionnaire/draft-stale"))],
    ["a cancelled request", new DOMException("aborted", "AbortError")],
    ["a query cancelled by the client", Object.assign(new Error("cancelled"), { name: "CancelledError" })],
  ])("reports nothing for %s, which the screen handles or the user caused", (_case, error) => {
    const { flush } = routed();

    reportQueryFailure(error);
    reportMutationFailure(error);

    expect(flush()).toEqual([]);
  });

  it("takes an error and nothing else, so no context, message or cache entry can be passed with it", () => {
    expect(reportQueryFailure.length).toBe(1);
    expect(reportMutationFailure.length).toBe(1);
  });
});
