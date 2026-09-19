import { FORMAT_VERSION, PROBLEM_CONTENT_TYPE, problemType } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { PublishedDefinitions } from "../../../src/db/execution/published-definitions.js";
import { aPublishedQuestionnaire, aQuestionnairePublishedAs, useTestDatabase } from "../../db/fixtures.js";
import { problemOf, startSession } from "./fixtures.js";
import { useExecutionApp } from "./harness.js";

const testDatabase = useTestDatabase();
const executionApp = useExecutionApp(testDatabase);

describe("a pinned snapshot the loader refuses", () => {
  it.each([
    ["stored under a format no upgrade reaches", { formatVersion: FORMAT_VERSION + 1 }],
    ["stored in the current format but not a PublishedDefinition", { title: "" }],
  ])("is 500 internal carrying no error text when %s, and starts no session", async (_, snapshotChanges) => {
    const { questionnaireId } = await aQuestionnairePublishedAs(testDatabase, snapshotChanges);
    const app = executionApp();

    const response = await startSession(app, questionnaireId);

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(problemOf(response)).toMatchObject({ type: problemType("internal"), status: 500 });
    expect(response.body).not.toContain("PublishedDefinition");
    const execution = await testDatabase.connect("execution");
    expect((await execution.query("SELECT count(*)::int AS n FROM execution.session")).rows[0].n).toBe(0);
  });
});

describe("PublishedDefinitions", () => {
  it("shares one in-flight load between callers asking for the same version", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = testDatabase.database("execution");
    const definitions = new PublishedDefinitions();

    const first = definitions.pinned(execution, published.draftVersionId);
    const second = definitions.pinned(execution, published.draftVersionId);

    expect(second).toBe(first);
    expect(await first).toBe(await second);
  });

  it("does not keep a failed load, so the next caller tries again", async () => {
    const execution = testDatabase.database("execution");
    const definitions = new PublishedDefinitions();
    const unknownVersion = "00000000-0000-0000-0000-000000000000";

    const failed = definitions.pinned(execution, unknownVersion);
    await expect(failed).rejects.toThrow("not published");

    expect(definitions.pinned(execution, unknownVersion)).not.toBe(failed);
  });
});
