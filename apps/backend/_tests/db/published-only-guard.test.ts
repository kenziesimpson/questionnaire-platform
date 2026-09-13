import { v4 as uuidv4 } from "uuid";
import { describe, expect, it } from "vitest";
import { aDraftWithOneItem, aPublishedQuestionnaire } from "./fixtures.js";
import { SQLSTATE, expectSqlState, useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

describe("a draft is structurally unreferenceable", () => {
  it("a session cannot pin a draft, whatever version number it invents", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    await expectSqlState(
      execution.query(
        `INSERT INTO execution.session (id, questionnaire_id, questionnaire_version_id, version, status)
         VALUES ($1, $2, $3, 1, 'in_progress')`,
        [uuidv4(), draft.questionnaireId, draft.draftVersionId],
      ),
      SQLSTATE.foreignKeyViolation,
    );
  });

  it("a session cannot pin another questionnaire's published version", async () => {
    const definitionDb = testDatabase.database("definition");
    const intake = await aPublishedQuestionnaire(definitionDb);
    const onboarding = await aPublishedQuestionnaire(definitionDb);
    const execution = await testDatabase.connect("execution");

    await expectSqlState(
      execution.query(
        `INSERT INTO execution.session (id, questionnaire_id, questionnaire_version_id, version, status)
         VALUES ($1, $2, $3, $4, 'in_progress')`,
        [uuidv4(), intake.questionnaireId, onboarding.draftVersionId, onboarding.version],
      ),
      SQLSTATE.foreignKeyViolation,
    );
  });

  it("a questionnaire cannot point its current version at its own draft", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(
        `UPDATE definition.questionnaire SET current_version_id = $1, current_version = 3 WHERE id = $2`,
        [draft.draftVersionId, draft.questionnaireId],
      ),
      SQLSTATE.foreignKeyViolation,
    );
  });

  it("a questionnaire cannot point its current version at another questionnaire's version", async () => {
    const definitionDb = testDatabase.database("definition");
    const intake = await aPublishedQuestionnaire(definitionDb);
    const onboarding = await aPublishedQuestionnaire(definitionDb);
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(
        `UPDATE definition.questionnaire SET current_version_id = $1, current_version = $2 WHERE id = $3`,
        [onboarding.draftVersionId, onboarding.version, intake.questionnaireId],
      ),
      SQLSTATE.foreignKeyViolation,
    );
  });

  it("a questionnaire cannot hold half of the current version pair", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(`UPDATE definition.questionnaire SET current_version = NULL WHERE id = $1`, [
        published.questionnaireId,
      ]),
      SQLSTATE.checkViolation,
    );
  });

  it("a session pins a published version of its own questionnaire", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    const inserted = await execution.query(
      `INSERT INTO execution.session (id, questionnaire_id, questionnaire_version_id, version, status)
       VALUES ($1, $2, $3, $4, 'in_progress')`,
      [uuidv4(), published.questionnaireId, published.draftVersionId, published.version],
    );

    expect(inserted.rowCount).toBe(1);
  });
});

describe("one draft per questionnaire", () => {
  it("rejects a second draft", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    const definition = await testDatabase.connect("definition");

    await expectSqlState(
      definition.query(
        `INSERT INTO definition.questionnaire_version (id, questionnaire_id, status, title)
         VALUES (gen_random_uuid(), $1, 'draft', 'Second draft')`,
        [draft.questionnaireId],
      ),
      SQLSTATE.uniqueViolation,
    );
  });
});

describe("session lifecycle", () => {
  it("rejects a submitted session without a digest", async () => {
    const published = await aPublishedQuestionnaire(testDatabase.database("definition"));
    const execution = await testDatabase.connect("execution");

    await expectSqlState(
      execution.query(
        `INSERT INTO execution.session (id, questionnaire_id, questionnaire_version_id, version, status, submitted_at)
         VALUES ($1, $2, $3, $4, 'submitted', now())`,
        [uuidv4(), published.questionnaireId, published.draftVersionId, published.version],
      ),
      SQLSTATE.checkViolation,
    );
  });
});
