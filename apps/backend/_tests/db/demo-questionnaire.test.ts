import { INTAKE_QUESTION_IDS, INTAKE_QUESTIONNAIRE_ID, intakeDefinition, PublishedDefinition } from "@qp/shared";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { seedDemoQuestionnaire } from "../../src/db/demo-questionnaire.js";
import { useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

describe("the demo seed", () => {
  it("publishes intakeDefinition(1) exactly, under the ids the questionnaire format doc prints", async () => {
    const outcome = await seedDemoQuestionnaire(testDatabase.database("definition"));

    const execution = await testDatabase.connect("execution");
    const current = await execution.query(
      `SELECT v.snapshot, v.version, q.key FROM definition.questionnaire q
         JOIN definition.questionnaire_version v ON v.id = q.current_version_id
        WHERE q.id = $1`,
      [INTAKE_QUESTIONNAIRE_ID],
    );
    expect(outcome).toBe("seeded");
    expect(INTAKE_QUESTIONNAIRE_ID).toBe("01a0950e-56a0-73d6-b936-4a1e10eff8c0");
    expect(Object.values(INTAKE_QUESTION_IDS)).toEqual([
      "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
      "01a0950f-4161-7719-98fb-afa43f4c6232",
      "01a0950f-41c2-7435-a65e-c53680e09195",
      "01a0950f-4223-73df-8544-fa8f63877e0b",
    ]);
    expect(current.rows[0]).toMatchObject({ version: 1, key: "qnr_intake" });
    expect(current.rows[0].snapshot).toEqual(intakeDefinition(1));
    expect(Value.Check(PublishedDefinition, current.rows[0].snapshot)).toBe(true);
  });

  it("leaves the condition question at version 3 in the bank and indexes each pinned version", async () => {
    await seedDemoQuestionnaire(testDatabase.database("definition"));

    const definition = await testDatabase.connect("definition");
    const versions = await definition.query(
      `SELECT max(version)::int AS latest FROM definition.question_version WHERE question_id = $1`,
      [INTAKE_QUESTION_IDS.whichCondition],
    );
    const index = await definition.query(
      `SELECT question_id, question_version FROM definition.version_question_index ORDER BY question_id`,
    );
    expect(versions.rows[0].latest).toBe(3);
    expect(index.rows).toEqual(
      Object.values(INTAKE_QUESTION_IDS)
        .sort()
        .map((questionId) => ({
          question_id: questionId,
          question_version: questionId === INTAKE_QUESTION_IDS.whichCondition ? 3 : 1,
        })),
    );
  });

  it("goes through the audited authoring path rather than inserting published rows", async () => {
    await seedDemoQuestionnaire(testDatabase.database("definition"));

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
    await seedDemoQuestionnaire(definitionDb);

    const second = await seedDemoQuestionnaire(definitionDb);

    const definition = await testDatabase.connect("definition");
    const versions = await definition.query(
      `SELECT count(*)::int AS n FROM definition.questionnaire_version WHERE questionnaire_id = $1`,
      [INTAKE_QUESTIONNAIRE_ID],
    );
    expect(second).toBe("already-seeded");
    expect(versions.rows[0].n).toBe(1);
  });
});
