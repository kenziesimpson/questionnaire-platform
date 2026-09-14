import type { DraftItemCode, ItemError, Predicate } from "@qp/shared";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { publishDraft } from "../../../src/db/definition/publish.js";
import { withLockedQuestionnaire } from "../../../src/db/definition/questionnaire-rows.js";
import { replaceDraft } from "../../../src/db/definition/drafts.js";
import { createQuestion } from "../../../src/db/definition/questions.js";
import {
  aDraftWithOneItem,
  aPublishedQuestionnaire,
  QUESTIONNAIRE_LOCK_STATEMENT,
  theStatementWaitingOnALock,
  whileHoldingALock,
} from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

interface Placement {
  readonly itemId: string;
  readonly visibleWhen: Predicate | null;
}

const invalidDrafts: [string, Placement[], ItemError<DraftItemCode>[]][] = [
  [
    "a forward reference",
    [
      { itemId: "itm_01", visibleWhen: { all: [{ type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" }] } },
      { itemId: "itm_02", visibleWhen: null },
    ],
    [{ itemId: "itm_01", code: "predicate/forward-reference" }],
  ],
  [
    "an unsatisfiable predicate",
    [
      { itemId: "itm_01", visibleWhen: null },
      {
        itemId: "itm_02",
        visibleWhen: {
          all: [
            { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" },
            { type: "single_choice", itemId: "itm_01", op: "is", optionId: "no" },
          ],
        },
      },
    ],
    [{ itemId: "itm_02", code: "predicate/unsatisfiable" }],
  ],
];

describe("publishDraft", () => {
  it("promotes the draft in place, writes the reverse index, moves the pointer and audits in one transaction", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      actorId: "author-1",
      traceId: "trace-1",
    });

    expect(outcome).toEqual({
      outcome: "published",
      questionnaireVersionId: draft.draftVersionId,
      version: 1,
      summary: {
        questionnaireId: draft.questionnaireId,
        version: 1,
        publishedAt: expect.any(String),
        publishedBy: null,
        itemCount: 1,
        formatVersion: 1,
      },
    });
    const client = await testDatabase.connect("definition");
    const version = await client.query(
      `SELECT status, version, format_version, snapshot, published_at IS NOT NULL AS stamped
         FROM definition.questionnaire_version WHERE id = $1`,
      [draft.draftVersionId],
    );
    expect(version.rows[0]).toMatchObject({ status: "published", version: 1, format_version: 1, stamped: true });
    expect(version.rows[0].snapshot).toEqual({
      formatVersion: 1,
      questionnaireId: draft.questionnaireId,
      version: 1,
      title: "Fixture",
      items: [
        {
          itemId: "itm_01",
          required: true,
          visibleWhen: null,
          question: { questionId: draft.questionId, questionVersion: 1, type: "text", prompt: "Anything else?" },
        },
      ],
    });
    const pointer = await client.query(`SELECT current_version_id, current_version FROM definition.questionnaire WHERE id = $1`, [
      draft.questionnaireId,
    ]);
    expect(pointer.rows[0]).toEqual({ current_version_id: draft.draftVersionId, current_version: 1 });
    const index = await client.query(
      `SELECT question_id, question_version FROM definition.version_question_index WHERE questionnaire_version_id = $1`,
      [draft.draftVersionId],
    );
    expect(index.rows).toEqual([{ question_id: draft.questionId, question_version: 1 }]);
    const events = await testDatabase.readAuditEvents();
    expect(events.filter((event) => event.action === "publish")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      action: "publish",
      questionnaire_id: draft.questionnaireId,
      questionnaire_version_id: draft.draftVersionId,
      version: 1,
      actor_id: "author-1",
    });
  });

  it("rolls the promotion back when the audit write fails", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const owner = await testDatabase.connect("owner");
    await owner.query("SET ROLE audit_owner");
    await owner.query(
      `ALTER TABLE audit.event ADD CONSTRAINT test_audit_write_fails CHECK (actor_id IS DISTINCT FROM 'audit-must-fail') NOT VALID`,
    );
    try {
      await expect(
        publishDraft(definitionDb, {
          questionnaireId: draft.questionnaireId,
          precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
          actorId: "audit-must-fail",
          traceId: null,
        }),
      ).rejects.toThrow();
    } finally {
      await owner.query("ALTER TABLE audit.event DROP CONSTRAINT test_audit_write_fails");
      await owner.query("RESET ROLE");
    }

    const client = await testDatabase.connect("definition");
    const version = await client.query(`SELECT status FROM definition.questionnaire_version WHERE id = $1`, [
      draft.draftVersionId,
    ]);
    const pointer = await client.query(`SELECT current_version_id FROM definition.questionnaire WHERE id = $1`, [
      draft.questionnaireId,
    ]);
    const index = await client.query(`SELECT 1 FROM definition.version_question_index WHERE questionnaire_version_id = $1`, [
      draft.draftVersionId,
    ]);
    expect(version.rows[0].status).toBe("draft");
    expect(pointer.rows[0].current_version_id).toBeNull();
    expect(index.rowCount).toBe(0);
  });

  it("refuses a stale draft revision and writes nothing", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const eventsBefore = await testDatabase.readAuditEvents();

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision - 1 },
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "stale" });
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
  });

  it("refuses the current revision when it names a different draft version", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: uuidv7(), draftRevision: draft.draftRevision },
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "stale" });
  });

  it.each(invalidDrafts)(
    "rejects %s with the draft-invalid items and promotes, indexes and audits nothing",
    async (_label, placements, expectedItems) => {
      const definitionDb = testDatabase.database("definition");
      const draft = await aDraftWithOneItem(definitionDb);
      const questionIds: string[] = [];
      for (const _placement of placements) {
        const saved = await createQuestion(definitionDb, {
          key: null,
          content: {
            type: "single_choice",
            prompt: "Pick one",
            options: [
              { optionId: "yes", label: "Yes" },
              { optionId: "no", label: "No" },
            ],
          },
          createdBy: "test",
          traceId: null,
        });
        questionIds.push(saved.questionId);
      }
      const edited = await replaceDraft(definitionDb, {
        questionnaireId: draft.questionnaireId,
        precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
        title: "Fixture",
        items: placements.map((placement, index) => ({
          itemId: placement.itemId,
          required: true,
          visibleWhen: placement.visibleWhen,
          questionId: questionIds[index] ?? "",
          questionVersion: 1,
        })),
        actorId: null,
        traceId: null,
      });
      if (edited.outcome !== "saved") {
        throw new Error(edited.outcome);
      }
      const eventsBefore = await testDatabase.readAuditEvents();

      const outcome = await publishDraft(definitionDb, {
        questionnaireId: draft.questionnaireId,
        precondition: { versionId: draft.draftVersionId, draftRevision: edited.draftRevision },
        actorId: null,
        traceId: null,
      });

      expect(outcome).toEqual({ outcome: "invalid", items: expectedItems });
      const client = await testDatabase.connect("definition");
      const version = await client.query(`SELECT status, version FROM definition.questionnaire_version WHERE id = $1`, [
        draft.draftVersionId,
      ]);
      const pointer = await client.query(`SELECT current_version_id FROM definition.questionnaire WHERE id = $1`, [
        draft.questionnaireId,
      ]);
      const index = await client.query(`SELECT 1 FROM definition.version_question_index WHERE questionnaire_version_id = $1`, [
        draft.draftVersionId,
      ]);
      expect(version.rows[0]).toEqual({ status: "draft", version: null });
      expect(pointer.rows[0].current_version_id).toBeNull();
      expect(index.rowCount).toBe(0);
      expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
    },
  );

  it("rejects a draft placing an archived question", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const client = await testDatabase.connect("definition");
    await client.query(`UPDATE definition.question SET archived_at = now() WHERE id = $1`, [draft.questionId]);

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "invalid", items: [{ itemId: "itm_01", code: "draft/question-archived" }] });
  });

  it("reports no draft once the only draft has been published", async () => {
    const definitionDb = testDatabase.database("definition");
    const published = await aPublishedQuestionnaire(definitionDb);

    const outcome = await publishDraft(definitionDb, {
      questionnaireId: published.questionnaireId,
      precondition: { versionId: published.draftVersionId, draftRevision: published.draftRevision },
      actorId: null,
      traceId: null,
    });

    expect(outcome).toEqual({ outcome: "no-draft" });
  });

  it("lets exactly one of two concurrent publishes of the same draft win", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const command = {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      actorId: null,
      traceId: null,
    };

    const outcomes = await Promise.all([publishDraft(definitionDb, command), publishDraft(definitionDb, command)]);

    expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual(["no-draft", "published"]);
  });

  it("waits on the questionnaire lock, as its first statement, while another transaction holds it", async () => {
    const definitionDb = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(definitionDb);
    const events: string[] = [];
    let publishing: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      definitionDb,
      (tx) => withLockedQuestionnaire(tx, draft.questionnaireId, async () => undefined),
      async () => {
        publishing = publishDraft(definitionDb, {
          questionnaireId: draft.questionnaireId,
          precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
          actorId: null,
          traceId: null,
        }).then((outcome) => events.push(`publish returned ${outcome.outcome}`));
        expect(await theStatementWaitingOnALock(testDatabase)).toMatch(QUESTIONNAIRE_LOCK_STATEMENT);
        events.push("lock holder commits");
      },
    );
    await publishing;

    expect(events).toEqual(["lock holder commits", "publish returned published"]);
  });
});
