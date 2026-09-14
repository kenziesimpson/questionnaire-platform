import { problemType } from "@qp/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { replyWithProblem } from "../../../src/http/problems.js";
import { AUTHOR_PLACEHOLDER, authenticateAuthor, authorOf } from "../../../src/modules/definition/author.js";

describe("the author hook", () => {
  it("is the placeholder author, pending real authentication (Decisions Log #57)", () => {
    expect(AUTHOR_PLACEHOLDER).toBe("prototype-author");
  });

  it("attaches the placeholder author to a request that passed through it", async () => {
    const app = Fastify();
    app.addHook("onRequest", authenticateAuthor);
    app.get("/who", async (request) => ({ author: authorOf(request) }));

    const response = await app.inject({ method: "GET", url: "/who" });

    expect(response.json()).toEqual({ author: AUTHOR_PLACEHOLDER });
    await app.close();
  });

  it("fails loudly when a route outside the hook reads the author, instead of writing no author", async () => {
    const app = Fastify();
    app.setErrorHandler(replyWithProblem);
    app.get("/who", async (request) => ({ author: authorOf(request) }));

    const response = await app.inject({ method: "GET", url: "/who" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ type: problemType("internal") });
    await app.close();
  });
});
