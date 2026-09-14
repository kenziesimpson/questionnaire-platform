import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { openNextDraft } from "../../../src/db/definition/drafts.js";
import { withLockedQuestionnaire } from "../../../src/db/definition/questionnaire-rows.js";
import {
  createQuestionnaire,
  listQuestionnaireSummaries,
  readQuestionnaireSummary,
  setClosesAt,
} from "../../../src/db/definition/questionnaires.js";
import { aPublishedQuestionnaire, QUESTIONNAIRE_LOCK_STATEMENT, theStatementWaitingOnALock, whileHoldingALock } from "../fixtures.js";
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

describe("setClosesAt", () => {
  it("waits on the questionnaire lock, as its first statement, while another transaction holds it", async () => {
    const definitionDb = testDatabase.database("definition");
    const created = await createQuestionnaire(definitionDb, { key: null, name: "Retired", title: "Retired", createdBy: null, traceId: null });
    const events: string[] = [];
    let retiring: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      definitionDb,
      (tx) => withLockedQuestionnaire(tx, created.questionnaireId, async () => undefined),
      async () => {
        retiring = setClosesAt(definitionDb, {
          questionnaireId: created.questionnaireId,
          closesAt: new Date("2031-01-01T00:00:00.000Z"),
          actorId: null,
          traceId: null,
        }).then((outcome) => events.push(`setClosesAt returned ${outcome.outcome}`));
        expect(await theStatementWaitingOnALock(testDatabase)).toMatch(QUESTIONNAIRE_LOCK_STATEMENT);
        events.push("lock holder commits");
      },
    );
    await retiring;

    expect(events).toEqual(["lock holder commits", "setClosesAt returned updated"]);
  });
});
