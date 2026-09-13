import { describe, expect, it } from "vitest";
import Fastify from "fastify";

/**
 * Smoke test proving the test runner + Fastify inject pattern works end to
 * end. Real domain tests (versioning, branching — see docs/2-design-doc.md
 * §15) land alongside the modules they cover.
 */
describe("health check", () => {
  it("responds 200 ok", async () => {
    const app = Fastify();
    app.get("/health", async () => ({ status: "ok" }));

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
