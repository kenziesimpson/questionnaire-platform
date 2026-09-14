import { describe, expect, it } from "vitest";
import { setClosesAt } from "../../../src/db/definition/closes-at.js";
import { withLockedQuestionnaire } from "../../../src/db/definition/questionnaire-rows.js";
import { createQuestionnaire } from "../../../src/db/definition/questionnaires.js";
import { QUESTIONNAIRE_LOCK_STATEMENT, theStatementWaitingOnALock, whileHoldingALock } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

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
