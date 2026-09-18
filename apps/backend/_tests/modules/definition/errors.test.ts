import { problemType } from "@qp/shared";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createQuestion } from "../../../src/db/definition/questions.js";
import { questionnaireItem, questionVersion } from "../../../src/db/schema.js";
import { replyWithDefinitionProblem } from "../../../src/modules/definition/errors.js";
import { actor, aPublishedQuestionnaire, aTextQuestion, useTestDatabase } from "../../db/fixtures.js";

const testDatabase = useTestDatabase();

let app: FastifyInstance;
let failure: () => Promise<unknown>;

beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler(replyWithDefinitionProblem);
  app.get("/fail", async () => {
    await failure();
    return {};
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function responseWhen(fails: () => Promise<unknown>) {
  failure = fails;
  return app.inject({ method: "GET", url: "/fail" });
}

describe("replyWithDefinitionProblem", () => {
  it("answers the immutability trigger, raised through drizzle, as version/immutable", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);

    const response = await responseWhen(() =>
      db.delete(questionnaireItem).where(eq(questionnaireItem.questionnaireVersionId, published.draftVersionId)),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: problemType("version/immutable"), instance: "/fail" });
  });

  it("answers a duplicate question version, raised through drizzle, as question/version-conflict", async () => {
    const db = testDatabase.database("definition");
    const saved = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });

    const response = await responseWhen(() =>
      db.insert(questionVersion).values({ questionId: saved.questionId, version: 1, type: "text", prompt: "Again" }),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: problemType("question/version-conflict"), instance: "/fail" });
  });

  it("answers any other unique violation as internal", async () => {
    const db = testDatabase.database("definition");
    await createQuestion(db, { key: "taken", content: aTextQuestion, ...actor });

    const response = await responseWhen(() => createQuestion(db, { key: "taken", content: aTextQuestion, ...actor }));

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ type: problemType("internal"), instance: "/fail" });
  });
});
