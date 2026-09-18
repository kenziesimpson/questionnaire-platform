import { FORMAT_VERSION, PROBLEM_CONTENT_TYPE, problemType } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { aQuestionnairePublishedAs } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";
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
