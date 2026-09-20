import { describe, expect, it } from "vitest";
import { createIngestCapacity, DEFAULT_INGEST_EVENTS_PER_SECOND } from "../src/ingest-capacity.js";

const SECOND = 1_000;

function admittedCount(capacity: ReturnType<typeof createIngestCapacity>, kind: "log" | "domain", attempts: number, at: number): number {
  return Array.from({ length: attempts }, () => capacity.admit(kind, at)).filter(Boolean).length;
}

describe("createIngestCapacity", () => {
  it("admits log events up to three quarters of the cap and domain events up to the whole cap, so the last quarter is theirs", () => {
    const capacity = createIngestCapacity(20);

    expect(admittedCount(capacity, "log", 40, 0)).toBe(15);
    expect(admittedCount(capacity, "domain", 40, 0)).toBe(5);
    expect(capacity.admit("domain", 0)).toBe(false);
    expect(capacity.admit("log", 0)).toBe(false);
  });

  it("rounds the reserve up, so a small cap still keeps one place for a domain event", () => {
    const capacity = createIngestCapacity(5);

    expect(admittedCount(capacity, "log", 10, 0)).toBe(3);
    expect(admittedCount(capacity, "domain", 10, 0)).toBe(2);
  });

  it("starts a fresh count in each second and keeps the count across calls within one", () => {
    const capacity = createIngestCapacity(4);

    expect(admittedCount(capacity, "log", 2, 4 * SECOND)).toBe(2);
    expect(admittedCount(capacity, "log", 2, 4 * SECOND + 999)).toBe(1);
    expect(admittedCount(capacity, "log", 5, 5 * SECOND)).toBe(3);
  });

  it("caps at the default when given no number", () => {
    expect(admittedCount(createIngestCapacity(), "domain", 1_000, 0)).toBe(DEFAULT_INGEST_EVENTS_PER_SECOND);
  });
});
