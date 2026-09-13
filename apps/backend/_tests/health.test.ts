import { describe, expect, it } from "vitest";
import Fastify from "fastify";

describe("health check", () => {
  it("responds 200 ok", async () => {
    const app = Fastify();
    app.get("/health", async () => ({ status: "ok" }));

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
