import { FORMAT_VERSION, PROBLEM_CONTENT_TYPE, problemType } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { aDraftWithOneItem, aTextQuestion } from "../../db/fixtures.js";
import { useTestDatabase } from "../../db/harness.js";
import { problemOf, startSession, useExecutionApp } from "./fixtures.js";

const testDatabase = useTestDatabase();
const executionApp = useExecutionApp(testDatabase);

async function aQuestionnairePublishedAs(snapshotChanges: Record<string, unknown>): Promise<string> {
  const draft = await aDraftWithOneItem(testDatabase.database("definition"));
  const snapshot = {
    formatVersion: FORMAT_VERSION,
    questionnaireId: draft.questionnaireId,
    version: 1,
    title: "Fixture",
    items: [
      {
        itemId: "itm_01",
        required: true,
        visibleWhen: null,
        question: { questionId: draft.questionId, questionVersion: 1, ...aTextQuestion },
      },
    ],
    ...snapshotChanges,
  };
  const definition = await testDatabase.connect("definition");
  await definition.query("SELECT definition.promote_draft($1::uuid, $2::jsonb)", [draft.draftVersionId, JSON.stringify(snapshot)]);
  return draft.questionnaireId;
}

describe("a pinned snapshot the loader refuses", () => {
  it.each([
    ["stored under a format no upgrade reaches", { formatVersion: FORMAT_VERSION + 1 }],
    ["stored in the current format but not a PublishedDefinition", { title: "" }],
  ])("is 500 internal carrying no error text when %s, and starts no session", async (_, snapshotChanges) => {
    const questionnaireId = await aQuestionnairePublishedAs(snapshotChanges);
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
