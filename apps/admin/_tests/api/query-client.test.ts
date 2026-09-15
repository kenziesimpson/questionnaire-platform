import { problem } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { ProblemError, UnexpectedResponseError } from "../../src/api/problem-error";
import { createQueryClient, shouldRetryQuery } from "../../src/api/query-client";

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
