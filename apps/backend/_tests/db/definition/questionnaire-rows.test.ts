import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { createNextDraft } from "../../../src/db/definition/drafts.js";
import { createQuestionnaire, setClosesAt } from "../../../src/db/definition/questionnaires.js";
import {
  lockOpenDraft,
  questionnaireExists,
  readOpenDraft,
  withLockedQuestionnaire,
} from "../../../src/db/definition/questionnaire-rows.js";
import { aPublishedQuestionnaire, QUESTIONNAIRE_LOCK_STATEMENT, theStatementWaitingOnALock, whileHoldingALock } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();
const actor = { createdBy: "test", traceId: null };

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

describe("lockOpenDraft and readOpenDraft", () => {
  it("find nothing when only a published version exists, then both return the next draft's row", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);

    const lockedBeforeOpening = await db.transaction((tx) => lockOpenDraft(tx, published.questionnaireId));
    const readBeforeOpening = await readOpenDraft(db, published.questionnaireId);
    const opened = await createNextDraft(db, { questionnaireId: published.questionnaireId, ...actor });
    if (opened.outcome !== "created") {
      throw new Error(opened.outcome);
    }
    const read = await readOpenDraft(db, published.questionnaireId);
    const locked = await db.transaction((tx) => lockOpenDraft(tx, published.questionnaireId));

    expect(lockedBeforeOpening).toBeUndefined();
    expect(readBeforeOpening).toBeUndefined();
    expect(read).toEqual({
      id: opened.draft.versionId,
      title: "Fixture",
      updatedAt: expect.any(Date),
      draftRevision: 0,
    });
    expect(read?.id).not.toBe(published.draftVersionId);
    expect(locked).toEqual(read);
  });

  it("while lockOpenDraft holds the draft row, readOpenDraft returns at once and a second lockOpenDraft waits until the first commits", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Draft lock", title: "Draft lock", ...actor });
    const events: string[] = [];
    let waiter: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      db,
      (tx) => lockOpenDraft(tx, created.questionnaireId),
      async () => {
        const read = await readOpenDraft(db, created.questionnaireId);
        events.push(`read returned ${read?.id === created.draftVersionId}`);
        waiter = db.transaction((tx) => lockOpenDraft(tx, created.questionnaireId)).then(() => events.push("second lock acquired"));
        await theStatementWaitingOnALock(testDatabase);
        events.push("first transaction commits");
      },
    );
    await waiter;

    expect(events).toEqual(["read returned true", "first transaction commits", "second lock acquired"]);
  });
});
