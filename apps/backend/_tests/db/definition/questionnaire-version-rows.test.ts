import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import type { Database } from "../../../src/db/client.js";
import { createNextDraft } from "../../../src/db/definition/drafts.js";
import { createQuestionnaire } from "../../../src/db/definition/questionnaires.js";
import { readOpenDraft, withCurrentDraft } from "../../../src/db/definition/questionnaire-version-rows.js";
import {
  actor,
  aPublishedQuestionnaire,
  theOpenDraftOf,
  theStatementWaitingOnALock,
  whileHoldingALock,
} from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

const DRAFT_LOCK_STATEMENT =
  /from "definition"\."questionnaire_version" where \("definition"\."questionnaire_version"\."questionnaire_id" = \$1 and "definition"\."questionnaire_version"\."status" = \$2\) for update$/;

function anotherVersionId(versionId: string): string {
  let other = uuidv7();
  while (other === versionId) {
    other = uuidv7();
  }
  return other;
}

async function aQuestionnaireWithADraft(db: Database, name: string): Promise<string> {
  const created = await createQuestionnaire(db, { key: null, name, title: name, ...actor });
  return created.questionnaireId;
}

describe("readOpenDraft", () => {
  it("finds nothing while only a published version exists, then returns the next draft's row", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);

    const beforeOpening = await readOpenDraft(db, published.questionnaireId);
    const opened = await createNextDraft(db, { questionnaireId: published.questionnaireId, ...actor });
    if (opened.outcome !== "created") {
      throw new Error(opened.outcome);
    }
    const afterOpening = await readOpenDraft(db, published.questionnaireId);

    expect(beforeOpening).toBeUndefined();
    expect(afterOpening).toEqual({
      id: opened.draft.versionId,
      title: "Fixture",
      updatedAt: expect.any(Date),
      draftRevision: 0,
    });
    expect(afterOpening?.id).not.toBe(published.draftVersionId);
  });
});

describe("withCurrentDraft", () => {
  it("runs the work on the open draft row when the precondition names it", async () => {
    const db = testDatabase.database("definition");
    const questionnaireId = await aQuestionnaireWithADraft(db, "Current");
    const precondition = await theOpenDraftOf(db, questionnaireId);

    const outcome = await db.transaction((tx) =>
      withCurrentDraft(tx, { questionnaireId, precondition }, async (draft) => ({ outcome: "worked" as const, id: draft.id })),
    );

    expect(outcome).toEqual({ outcome: "worked", id: precondition.versionId });
  });

  it("is no-draft when nothing is open, and stale when either the version id or the revision differs", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);
    const questionnaireId = await aQuestionnaireWithADraft(db, "Stale");
    const precondition = await theOpenDraftOf(db, questionnaireId);
    let ran = false;
    const run = (id: string, command: { versionId: string; draftRevision: number }) =>
      db.transaction((tx) =>
        withCurrentDraft(tx, { questionnaireId: id, precondition: command }, async () => {
          ran = true;
          return { outcome: "worked" as const };
        }),
      );

    expect(await run(published.questionnaireId, precondition)).toEqual({ outcome: "no-draft" });
    expect(await run(questionnaireId, { ...precondition, draftRevision: precondition.draftRevision + 1 })).toEqual({
      outcome: "stale",
    });
    expect(await run(questionnaireId, { ...precondition, versionId: anotherVersionId(precondition.versionId) })).toEqual({
      outcome: "stale",
    });
    expect(ran).toBe(false);
  });

  it("locks the draft row, so a second caller waits until the first transaction commits", async () => {
    const db = testDatabase.database("definition");
    const questionnaireId = await aQuestionnaireWithADraft(db, "Draft lock");
    const precondition = await theOpenDraftOf(db, questionnaireId);
    const events: string[] = [];
    let waiter: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      db,
      (tx) => withCurrentDraft(tx, { questionnaireId, precondition }, async () => undefined),
      async () => {
        events.push(`read returned ${(await readOpenDraft(db, questionnaireId))?.id === precondition.versionId}`);
        waiter = db
          .transaction((tx) => withCurrentDraft(tx, { questionnaireId, precondition }, async () => undefined))
          .then(() => events.push("second lock acquired"));
        expect(await theStatementWaitingOnALock(testDatabase)).toMatch(DRAFT_LOCK_STATEMENT);
        events.push("first transaction commits");
      },
    );
    await waiter;

    expect(events).toEqual(["read returned true", "first transaction commits", "second lock acquired"]);
  });
});
