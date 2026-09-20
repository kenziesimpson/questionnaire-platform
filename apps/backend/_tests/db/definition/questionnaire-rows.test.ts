import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { createQuestionnaire, setClosesAt } from "../../../src/db/definition/questionnaires.js";
import { questionnaireExists, withLockedQuestionnaire } from "../../../src/db/definition/questionnaire-rows.js";
import { actor, QUESTIONNAIRE_LOCK_STATEMENT, theStatementWaitingOnALock, whileHoldingALock } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

describe("withLockedQuestionnaire", () => {
  it("hands the work the locked row with its closing time and returns the work's result", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Locked", title: "Locked", ...actor });
    const closesAt = new Date("2031-01-01T00:00:00.000Z");
    await setClosesAt(db, { questionnaireId: created.questionnaireId, closesAt, actorId: null, traceId: null });

    const result = await withLockedQuestionnaire(db, created.questionnaireId, async (_tx, locked) => ({ outcome: "worked", locked }));

    expect(result).toEqual({ outcome: "worked", locked: { id: created.questionnaireId, closesAt } });
  });

  it("returns questionnaire-not-found for an unknown questionnaire without running the work", async () => {
    const db = testDatabase.database("definition");
    let ran = false;

    const result = await withLockedQuestionnaire(db, uuidv7(), async () => {
      ran = true;
    });

    expect(result).toEqual({ outcome: "questionnaire-not-found" });
    expect(ran).toBe(false);
  });

  it("makes a second transaction's lock on the same questionnaire wait until the first commits", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Contended", title: "Contended", ...actor });
    const events: string[] = [];
    let waiter: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      db,
      (tx) => withLockedQuestionnaire(tx, created.questionnaireId, async () => undefined),
      async () => {
        waiter = withLockedQuestionnaire(db, created.questionnaireId, async () => events.push("second lock acquired"));
        expect(await theStatementWaitingOnALock(testDatabase)).toMatch(QUESTIONNAIRE_LOCK_STATEMENT);
        events.push("first transaction commits");
      },
    );
    await waiter;

    expect(events).toEqual(["first transaction commits", "second lock acquired"]);
  });
});

describe("questionnaireExists", () => {
  it("is true for a questionnaire and false for an unknown id", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Exists", title: "Exists", ...actor });

    expect(await questionnaireExists(db, created.questionnaireId)).toBe(true);
    expect(await questionnaireExists(db, uuidv7())).toBe(false);
  });
});
