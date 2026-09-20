import { problem } from "@qp/shared";
import { MutationObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { ProblemError, UnexpectedResponseError } from "../../src/api/problem-error";
import { createQueryClient, shouldRetryQuery } from "../../src/api/query-client";
import { routedQueue } from "../support/telemetry";

describe("the app's query client", () => {
  it("does not retry a 4xx problem, which a retry cannot change, but retries a 5xx or a network failure up to three times", () => {
    const notFound = new ProblemError("resource/not-found", 404, problem("resource/not-found"));
    const internal = new ProblemError("internal", 500, problem("internal", { detail: "trace" }));
    const gateway = new UnexpectedResponseError(502, "not a problem+json body");
    const network = new TypeError("Failed to fetch");

    expect(shouldRetryQuery(0, notFound)).toBe(false);
    expect([internal, gateway, network].map((error) => shouldRetryQuery(2, error))).toEqual([true, true, true]);
    expect([internal, gateway, network].map((error) => shouldRetryQuery(3, error))).toEqual([false, false, false]);
  });

  it("keeps TanStack Query's refetch-on-window-focus default (#69)", () => {
    expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBeUndefined();
  });
});

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

describe("the app's query client reports what a screen cannot handle", () => {
  it("queues one client warning, with the error's class and no cache entry, when a query fails with a 500, even with an answer in the cache", async () => {
    const { flush } = routed();
    const client = createQueryClient();
    client.setQueryData(["responses", "session"], { answer: ANSWER_SENTINEL });

    await client
      .fetchQuery({
        queryKey: ["responses", "session"],
        staleTime: 0,
        retry: false,
        queryFn: () => Promise.reject(new ProblemError("internal", 500, problem("internal", { detail: ANSWER_SENTINEL }))),
      })
      .catch(() => undefined);

    const events = flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: "warn", message: "query failed", attributes: { "error.type": "ProblemError" } });
    expect(JSON.stringify(events)).not.toContain(ANSWER_SENTINEL);
  });

  it("reports nothing when a query fails with a 404 problem, which the screen shows", async () => {
    const { flush } = routed();
    const client = createQueryClient();

    await client
      .fetchQuery({
        queryKey: ["responses", "missing"],
        retry: false,
        queryFn: () => Promise.reject(new ProblemError("resource/not-found", 404, problem("resource/not-found"))),
      })
      .catch(() => undefined);

    expect(flush()).toEqual([]);
  });

  it("queues one client warning when a mutation fails with a network error, and none when it fails with a 4xx problem", async () => {
    const { flush } = routed();
    const client = createQueryClient();

    await new MutationObserver(client, { mutationFn: () => Promise.reject(new TypeError(ANSWER_SENTINEL)) }).mutate().catch(() => undefined);
    await new MutationObserver(client, {
      mutationFn: () => Promise.reject(new ProblemError("questionnaire/draft-stale", 409, problem("questionnaire/draft-stale"))),
    })
      .mutate()
      .catch(() => undefined);

    const events = flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: "warn", message: "mutation failed", attributes: { "error.type": "TypeError" } });
    expect(JSON.stringify(events)).not.toContain(ANSWER_SENTINEL);
  });
});
