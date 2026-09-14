import { desc } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../../../src/db/client.js";
import { createQuestionnaire, openNextDraft } from "../../../src/db/definition/questionnaires.js";
import {
  hasOpenDraft,
  lockQuestionnaire,
  openDraftExists,
  questionnaireExists,
  readOpenDraft,
} from "../../../src/db/definition/questionnaire-rows.js";
import { questionnaire } from "../../../src/db/schema.js";
import { aPublishedQuestionnaire } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();
const actor = { createdBy: "test", traceId: null };

async function sessionsWaitingOnALock(): Promise<number> {
  const client = await testDatabase.connect("definition");
  const result = await client.query<{ waiting: number }>(
    "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  );
  return result.rows[0]?.waiting ?? 0;
}

async function eventually(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the condition never held");
}

async function whileHoldingALock(
  holdLock: (tx: Transaction) => Promise<unknown>,
  whileHeld: () => Promise<void>,
): Promise<void> {
  const db = testDatabase.database("definition");
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalHeld: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    signalHeld = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await holdLock(tx);
    signalHeld();
    await released;
  });
  await held;
  try {
    await whileHeld();
  } finally {
    release();
    await holder;
  }
}

describe("lockQuestionnaire", () => {
  it("returns the locked row with its closing time, and nothing for an unknown questionnaire", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Locked", title: "Locked", ...actor });

    const [locked, unknown] = await db.transaction(async (tx) =>
      Promise.all([lockQuestionnaire(tx, created.questionnaireId), lockQuestionnaire(tx, uuidv7())]),
    );

    expect(locked).toEqual({ id: created.questionnaireId, closesAt: null });
    expect(unknown).toBeUndefined();
  });

  it("makes a second transaction's lock on the same questionnaire wait until the first commits", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Contended", title: "Contended", ...actor });
    const events: string[] = [];
    let waiter: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      (tx) => lockQuestionnaire(tx, created.questionnaireId),
      async () => {
        waiter = db
          .transaction((tx) => lockQuestionnaire(tx, created.questionnaireId))
          .then(() => events.push("second lock acquired"));
        await eventually(async () => (await sessionsWaitingOnALock()) === 1);
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

describe("readOpenDraft", () => {
  it("returns the open draft and ignores published versions, with the same row whether locked or not", async () => {
    const db = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(db);

    const beforeOpening = await db.transaction((tx) => readOpenDraft(tx, published.questionnaireId, "for-update"));
    const opened = await openNextDraft(db, { questionnaireId: published.questionnaireId, ...actor });
    if (opened.outcome !== "opened") {
      throw new Error(opened.outcome);
    }
    const unlocked = await readOpenDraft(db, published.questionnaireId, "unlocked");
    const locked = await db.transaction((tx) => readOpenDraft(tx, published.questionnaireId, "for-update"));

    expect(beforeOpening).toBeUndefined();
    expect(unlocked).toEqual({
      id: opened.draft.versionId,
      title: "Fixture",
      updatedAt: expect.any(Date),
      draftRevision: 0,
    });
    expect(unlocked?.id).not.toBe(published.draftVersionId);
    expect(locked).toEqual(unlocked);
  });

  it("waits behind a locked draft only when asked to lock it", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Draft lock", title: "Draft lock", ...actor });
    const events: string[] = [];
    let waiter: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      (tx) => readOpenDraft(tx, created.questionnaireId, "for-update"),
      async () => {
        const unlocked = await readOpenDraft(db, created.questionnaireId, "unlocked");
        events.push(`unlocked read returned ${unlocked?.id === created.draftVersionId}`);
        waiter = db
          .transaction((tx) => readOpenDraft(tx, created.questionnaireId, "for-update"))
          .then(() => events.push("locked read returned"));
        await eventually(async () => (await sessionsWaitingOnALock()) === 1);
        events.push("first transaction commits");
      },
    );
    await waiter;

    expect(events).toEqual(["unlocked read returned true", "first transaction commits", "locked read returned"]);
  });
});

describe("hasOpenDraft and openDraftExists", () => {
  it("agree for a draft-only, a published-only and a republished-with-draft questionnaire", async () => {
    const db = testDatabase.database("definition");
    const draftOnly = await createQuestionnaire(db, { key: null, name: "Draft only", title: "Draft only", ...actor });
    const publishedOnly = await aPublishedQuestionnaire(db);
    const reopened = await aPublishedQuestionnaire(db);
    await openNextDraft(db, { questionnaireId: reopened.questionnaireId, ...actor });

    const correlated = await db
      .select({ questionnaireId: questionnaire.id, hasDraft: openDraftExists(db, questionnaire.id) })
      .from(questionnaire)
      .orderBy(desc(questionnaire.id));
    const direct = await Promise.all(
      correlated.map(async (row) => ({ questionnaireId: row.questionnaireId, hasDraft: await hasOpenDraft(db, row.questionnaireId) })),
    );

    expect(correlated).toEqual(direct);
    expect(new Map(direct.map((row) => [row.questionnaireId, row.hasDraft]))).toEqual(
      new Map([
        [draftOnly.questionnaireId, true],
        [publishedOnly.questionnaireId, false],
        [reopened.questionnaireId, true],
      ]),
    );
    expect(await hasOpenDraft(db, uuidv7())).toBe(false);
  });
});
