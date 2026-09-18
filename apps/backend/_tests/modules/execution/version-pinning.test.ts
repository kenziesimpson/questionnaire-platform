import { problemType, type PublishedDefinition } from "@qp/shared";
import { INTAKE_QUESTION_IDS, intakeDefinition } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import {
  answersYes,
  getSession,
  problemOf,
  publishIntakeV2Relabel,
  publishIntakeV2TighteningDiagnosisDate,
  SENTINEL_DATE,
  seedIntakeV1,
  startedSessionId,
  startSession,
  submit,
  useExecutionApp,
} from "../../db/execution/fixtures.js";
import { useTestDatabase } from "../../db/fixtures.js";

const testDatabase = useTestDatabase();
const executionApp = useExecutionApp(testDatabase);

function hypertensionLabel(definition: PublishedDefinition): string | undefined {
  const whichCondition = definition.items.find((item) => item.itemId === "itm_02")?.question;
  return whichCondition?.type === "single_choice"
    ? whichCondition.options.find((option) => option.optionId === "opt_hyperten")?.label
    : undefined;
}

describe("a session pins the version it started on", () => {
  it("keeps serving v1 to a session started before v2 is published, while a new session gets v2", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const beforePublish = await startedSessionId(app);

    await publishIntakeV2Relabel(testDatabase);
    const afterPublish = (await startSession(app)).json();
    const resumed = (await getSession(app, beforePublish)).json();

    expect(resumed.session.version).toBe(1);
    expect(resumed.definition).toEqual(intakeDefinition(1));
    expect(afterPublish.session.version).toBe(2);
    expect(afterPublish.definition).toEqual(intakeDefinition(2));
  });

  it("re-evaluates submit against the pinned definition: the same answers are accepted under v1 and rejected under a v2 that hides itm_03", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const pinnedToV1 = await startedSessionId(app);
    await publishIntakeV2TighteningDiagnosisDate(testDatabase);
    const pinnedToV2 = await startedSessionId(app);
    const answers = answersYes({
      itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" },
      itm_03: { type: "date", date: SENTINEL_DATE },
    });

    const underV1 = await submit(app, pinnedToV1, answers);
    const underV2 = await submit(app, pinnedToV2, answers);

    expect(underV1.statusCode).toBe(200);
    expect(underV1.json().receipt.version).toBe(1);
    expect(underV2.statusCode).toBe(422);
    expect(problemOf(underV2)).toMatchObject({
      type: problemType("submission/invalid"),
      items: [{ itemId: "itm_03", code: "answer/not-visible" }],
    });
    expect(underV2.body).not.toContain(SENTINEL_DATE);
  });

  it("rejects v1's required diagnosis date as missing when a v1 session omits it, even after v2 stopped asking for it", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const pinnedToV1 = await startedSessionId(app);
    await publishIntakeV2TighteningDiagnosisDate(testDatabase);

    const response = await submit(
      app,
      pinnedToV1,
      answersYes({ itm_02: { type: "single_choice", optionId: "other", otherText: "Asthma" }, itm_03: null }),
    );

    expect(problemOf(response).items).toEqual([{ itemId: "itm_03", code: "answer/required" }]);
  });
});

describe("cross-version aggregation", () => {
  it("aggregates v1 and v2 answers on opt_hyperten by questionId, while each session renders through its own pinned question version", async () => {
    await seedIntakeV1(testDatabase);
    const app = executionApp();
    const underV1 = await startedSessionId(app);
    await publishIntakeV2Relabel(testDatabase);
    const underV2 = await startedSessionId(app);

    expect((await submit(app, underV1, answersYes())).statusCode).toBe(200);
    expect((await submit(app, underV2, answersYes())).statusCode).toBe(200);

    const execution = await testDatabase.connect("execution");
    const aggregate = await execution.query(
      `SELECT count(*)::int AS respondents, array_agg(DISTINCT question_version ORDER BY question_version) AS question_versions
         FROM execution.response
        WHERE question_id = $1 AND 'opt_hyperten' = ANY(option_ids)`,
      [INTAKE_QUESTION_IDS.whichCondition],
    );
    expect(aggregate.rows).toEqual([{ respondents: 2, question_versions: [3, 4] }]);

    const renderedV1 = (await getSession(app, underV1)).json();
    const renderedV2 = (await getSession(app, underV2)).json();
    expect(renderedV1.session).toMatchObject({ status: "submitted", version: 1 });
    expect(renderedV2.session).toMatchObject({ status: "submitted", version: 2 });
    expect(hypertensionLabel(renderedV1.definition)).toBe("Hypertension");
    expect(hypertensionLabel(renderedV2.definition)).toBe("High blood pressure (hypertension)");

    const pinnedVersions = await execution.query(
      `SELECT s.version, r.question_version, v.snapshot
         FROM execution.response r
         JOIN execution.session s ON s.id = r.session_id
         JOIN definition.published_questionnaire_version v ON v.id = r.questionnaire_version_id
        WHERE r.item_id = 'itm_02'
        ORDER BY s.version`,
    );
    expect(
      pinnedVersions.rows.map((row) => ({
        version: row.version,
        questionVersion: row.question_version,
        label: hypertensionLabel(row.snapshot as PublishedDefinition),
      })),
    ).toEqual([
      { version: 1, questionVersion: 3, label: "Hypertension" },
      { version: 2, questionVersion: 4, label: "High blood pressure (hypertension)" },
    ]);
  });
});
