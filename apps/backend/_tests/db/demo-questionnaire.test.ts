import { PublishedDefinition } from "@qp/shared";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { DEMO_QUESTION_IDS, DEMO_QUESTIONNAIRE_ID, seedDemoQuestionnaire } from "../../src/db/demo-questionnaire.js";
import { acceptAll } from "./fixtures.js";
import { useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

const documentedVersionOne = {
  formatVersion: 1,
  questionnaireId: "01a0950e-56a0-73d6-b936-4a1e10eff8c0",
  version: 1,
  title: "Patient Intake",
  items: [
    {
      itemId: "itm_01",
      required: true,
      visibleWhen: null,
      question: {
        questionId: "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
        questionVersion: 1,
        type: "single_choice",
        prompt: "Do you have a medical condition?",
        options: [
          { optionId: "yes", label: "Yes" },
          { optionId: "no", label: "No" },
        ],
      },
    },
    {
      itemId: "itm_02",
      required: true,
      visibleWhen: { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] },
      question: {
        questionId: "01a0950f-4161-7719-98fb-afa43f4c6232",
        questionVersion: 3,
        type: "single_choice",
        prompt: "Which condition?",
        options: [
          { optionId: "opt_diabetes", label: "Diabetes" },
          { optionId: "opt_hyperten", label: "Hypertension" },
          { optionId: "other", label: "Other", freeform: true },
        ],
      },
    },
    {
      itemId: "itm_03",
      required: true,
      visibleWhen: { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] },
      question: {
        questionId: "01a0950f-41c2-7435-a65e-c53680e09195",
        questionVersion: 1,
        type: "date",
        prompt: "When were you diagnosed?",
        relative: "not_future",
      },
    },
    {
      itemId: "itm_04",
      required: true,
      visibleWhen: null,
      question: {
        questionId: "01a0950f-4223-73df-8544-fa8f63877e0b",
        questionVersion: 1,
        type: "text",
        prompt: "Preferred pharmacy",
        maxLength: 120,
      },
    },
  ],
};

describe("the demo seed", () => {
  it("publishes exactly the documented version 1 snapshot, under the hardcoded ids", async () => {
    const outcome = await seedDemoQuestionnaire(testDatabase.database("definition"), acceptAll);

    const execution = await testDatabase.connect("execution");
    const current = await execution.query(
      `SELECT v.snapshot, v.version, q.key FROM definition.questionnaire q
         JOIN definition.questionnaire_version v ON v.id = q.current_version_id
        WHERE q.id = $1`,
      [DEMO_QUESTIONNAIRE_ID],
    );
    expect(outcome).toBe("seeded");
    expect(current.rows[0]).toMatchObject({ version: 1, key: "qnr_intake" });
    expect(current.rows[0].snapshot).toEqual(documentedVersionOne);
    expect(Value.Check(PublishedDefinition, current.rows[0].snapshot)).toBe(true);
  });

  it("leaves the condition question at version 3 in the bank and indexes each pinned version", async () => {
    await seedDemoQuestionnaire(testDatabase.database("definition"), acceptAll);

    const definition = await testDatabase.connect("definition");
    const versions = await definition.query(
      `SELECT max(version)::int AS latest FROM definition.question_version WHERE question_id = $1`,
      [DEMO_QUESTION_IDS.whichCondition],
    );
    const index = await definition.query(
      `SELECT question_id, question_version FROM definition.version_question_index ORDER BY question_id`,
    );
    expect(versions.rows[0].latest).toBe(3);
    expect(index.rows).toEqual(
      Object.values(DEMO_QUESTION_IDS)
        .sort()
        .map((questionId) => ({
          question_id: questionId,
          question_version: questionId === DEMO_QUESTION_IDS.whichCondition ? 3 : 1,
        })),
    );
  });

  it("goes through the audited authoring path rather than inserting published rows", async () => {
    await seedDemoQuestionnaire(testDatabase.database("definition"), acceptAll);

    const actions = (await testDatabase.readAuditEvents()).map((event) => event.action).sort();
    expect(actions).toEqual([
      "create_draft",
      "create_question_version",
      "create_question_version",
      "create_question_version",
      "create_question_version",
      "create_question_version",
      "create_question_version",
      "edit_draft",
      "publish",
    ]);
  });

  it("is idempotent across repeated compose runs", async () => {
    const definitionDb = testDatabase.database("definition");
    await seedDemoQuestionnaire(definitionDb, acceptAll);

    const second = await seedDemoQuestionnaire(definitionDb, acceptAll);

    const definition = await testDatabase.connect("definition");
    const versions = await definition.query(
      `SELECT count(*)::int AS n FROM definition.questionnaire_version WHERE questionnaire_id = $1`,
      [DEMO_QUESTIONNAIRE_ID],
    );
    expect(second).toBe("already-seeded");
    expect(versions.rows[0].n).toBe(1);
  });

  it("rolls back entirely when publish rules reject it", async () => {
    const definitionDb = testDatabase.database("definition");

    await expect(seedDemoQuestionnaire(definitionDb, () => ["rejected"])).rejects.toThrow("invalid");

    const definition = await testDatabase.connect("definition");
    const questions = await definition.query(`SELECT count(*)::int AS n FROM definition.question`);
    expect(questions.rows[0].n).toBe(0);
    expect(await testDatabase.readAuditEvents()).toEqual([]);
  });
});
