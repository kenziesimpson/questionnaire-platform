import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { createNextDraft, replaceDraft } from "../../../src/db/definition/drafts.js";
import { withLockedQuestionnaire } from "../../../src/db/definition/questionnaire-rows.js";
import {
  createQuestionnaire,
  listQuestionnaireSummaries,
  readQuestionnaireSummary,
  setClosesAt,
} from "../../../src/db/definition/questionnaires.js";
import {
  actor,
  aPublishedQuestionnaire,
  QUESTIONNAIRE_LOCK_STATEMENT,
  theStatementWaitingOnALock,
  whileHoldingALock,
} from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

describe("readQuestionnaireSummary", () => {
  it("reports hasDraft for a draft-only, a published-only and a republished-with-draft questionnaire, equal to the list entry", async () => {
    const db = testDatabase.database("definition");
    const draftOnly = await createQuestionnaire(db, { key: null, name: "Draft only", title: "Draft only", ...actor });
    const publishedOnly = await aPublishedQuestionnaire(db);
    const reopened = await aPublishedQuestionnaire(db);
    await createNextDraft(db, { questionnaireId: reopened.questionnaireId, ...actor });

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

describe("listQuestionnaireSummaries updatedAt", () => {
  it("is the latest questionnaire_version.updated_at, moved by a draft write and not by setClosesAt", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestionnaire(db, { key: null, name: "Edited", title: "Edited", ...actor });
    const client = await testDatabase.connect("definition");
    await client.query("UPDATE definition.questionnaire_version SET updated_at = $1 WHERE id = $2", ["2026-01-01T00:00:00.000Z", created.draftVersionId]);
    const updatedAtOf = async () => (await readQuestionnaireSummary(db, created.questionnaireId))?.updatedAt;
    expect(await updatedAtOf()).toBe("2026-01-01T00:00:00.000Z");

    await setClosesAt(db, { questionnaireId: created.questionnaireId, closesAt: new Date("2031-01-01T00:00:00.000Z"), actorId: null, traceId: null });
    expect(await updatedAtOf()).toBe("2026-01-01T00:00:00.000Z");

    const written = await replaceDraft(db, {
      questionnaireId: created.questionnaireId,
      precondition: { versionId: created.draftVersionId, draftRevision: created.draftRevision },
      title: "Edited again",
      items: [],
      actorId: null,
      traceId: null,
    });
    const stored = await client.query<{ updated_at: Date }>("SELECT updated_at FROM definition.questionnaire_version WHERE id = $1", [
      created.draftVersionId,
    ]);

    expect(written.outcome).toBe("saved");
    expect(await updatedAtOf()).toBe(stored.rows[0]?.updated_at.toISOString());
    expect(await updatedAtOf()).not.toBe("2026-01-01T00:00:00.000Z");
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
