import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { listQuestionnaireSummaries, readQuestionnaireSummary } from "../../../src/db/definition/questionnaire-list.js";
import { createQuestionnaire, openNextDraft } from "../../../src/db/definition/questionnaires.js";
import { aPublishedQuestionnaire } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();
const actor = { createdBy: "test", traceId: null };

describe("readQuestionnaireSummary", () => {
  it("reports hasDraft for a draft-only, a published-only and a republished-with-draft questionnaire, equal to the list entry", async () => {
    const db = testDatabase.database("definition");
    const draftOnly = await createQuestionnaire(db, { key: null, name: "Draft only", title: "Draft only", ...actor });
    const publishedOnly = await aPublishedQuestionnaire(db);
    const reopened = await aPublishedQuestionnaire(db);
    await openNextDraft(db, { questionnaireId: reopened.questionnaireId, ...actor });

    const listed = await listQuestionnaireSummaries(db);
    const read = await Promise.all(listed.map((entry) => readQuestionnaireSummary(db, entry.questionnaireId)));

    expect(read).toEqual(listed);
    expect(new Map(listed.map((entry) => [entry.questionnaireId, entry.hasDraft]))).toEqual(
      new Map([
        [draftOnly.questionnaireId, true],
        [publishedOnly.questionnaireId, false],
        [reopened.questionnaireId, true],
      ]),
    );
  });

  it("is undefined for an unknown questionnaire", async () => {
    const db = testDatabase.database("definition");

    expect(await readQuestionnaireSummary(db, uuidv7())).toBeUndefined();
  });
});
