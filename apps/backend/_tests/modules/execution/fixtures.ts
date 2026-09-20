import { draftItemOf, executionApi, questionInputOf, type ClientAnswers, type Item } from "@qp/shared";
import { INTAKE_QUESTION_IDS, INTAKE_QUESTIONNAIRE_ID, intakeDefinition } from "@qp/shared/demo";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { appendQuestionVersion, createQuestion } from "../../../src/db/definition/questions.js";
import { seedDemoQuestionnaire } from "../../../src/db/seed/demo-questionnaire.js";
import { actor, aPublishedQuestionnaireOf, publishNextVersion, type TestDatabase } from "../../db/fixtures.js";

export const SENTINEL_TEXT = "SENTINEL-ANSWER-7f3a";
export const SENTINEL_DATE = "1999-12-31";

export function executionUrl(path: string): string {
  return `${executionApi.EXECUTION_PREFIX}${path}`;
}

export async function seedIntakeV1(testDatabase: TestDatabase): Promise<void> {
  const outcome = await seedDemoQuestionnaire(testDatabase.database("definition"));
  if (outcome !== "seeded") {
    throw new Error(`intake v1 was not seeded: ${outcome}`);
  }
}

export async function publishIntakeV2Relabel(testDatabase: TestDatabase): Promise<void> {
  const definition = testDatabase.database("definition");
  const v2 = intakeDefinition(2);
  const relabelled = v2.items.find((item) => item.question.questionId === INTAKE_QUESTION_IDS.whichCondition);
  if (relabelled === undefined) throw new Error("intake v2 no longer has the whichCondition item");
  const appended = await appendQuestionVersion(definition, {
    questionId: INTAKE_QUESTION_IDS.whichCondition,
    content: questionInputOf(relabelled.question),
    ...actor,
  });
  if (appended.outcome !== "saved" || appended.questionVersion !== relabelled.question.questionVersion) {
    throw new Error("the relabelled question version does not match intake v2");
  }
  await publishNextVersion(definition, INTAKE_QUESTIONNAIRE_ID, v2.items.map(draftItemOf));
}

export async function publishIntakeV2TighteningDiagnosisDate(testDatabase: TestDatabase): Promise<void> {
  const items = intakeDefinition(1).items.map((item): Item =>
    item.itemId === "itm_03"
      ? {
          ...item,
          visibleWhen: {
            all: [
              { type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" },
              { type: "single_choice", itemId: "itm_02", op: "isNot", optionId: "other" },
            ],
          },
        }
      : item,
  );
  await publishNextVersion(testDatabase.database("definition"), INTAKE_QUESTIONNAIRE_ID, items.map(draftItemOf));
}

export interface MeasurementsFixture {
  readonly questionnaireId: string;
  readonly weightQuestionId: string;
  readonly symptomsQuestionId: string;
}

export async function publishMeasurementsQuestionnaire(testDatabase: TestDatabase): Promise<MeasurementsFixture> {
  const definition = testDatabase.database("definition");
  const weight = await createQuestion(definition, {
    key: null,
    content: { type: "number", prompt: "Weight", numberKind: "float", min: 0, max: 500, unit: "kg" },
    ...actor,
  });
  const symptoms = await createQuestion(definition, {
    key: null,
    content: {
      type: "multiple_choice",
      prompt: "Symptoms",
      options: [
        { optionId: "opt_cough", label: "Cough" },
        { optionId: "opt_fever", label: "Fever" },
        { optionId: "other", label: "Other", freeform: true },
      ],
    },
    ...actor,
  });
  const questionnaireId = await aPublishedQuestionnaireOf(definition, "Measurements", [
    { itemId: "itm_weight", required: true, visibleWhen: null, questionId: weight.questionId, questionVersion: 1 },
    { itemId: "itm_symptoms", required: false, visibleWhen: null, questionId: symptoms.questionId, questionVersion: 1 },
  ]);
  return {
    questionnaireId,
    weightQuestionId: weight.questionId,
    symptomsQuestionId: symptoms.questionId,
  };
}

export const answersYes = (overrides: ClientAnswers = {}): ClientAnswers => ({
  itm_01: { type: "single_choice", optionId: "yes" },
  itm_02: { type: "single_choice", optionId: "opt_hyperten" },
  itm_03: { type: "date", date: "2019-04-02" },
  itm_04: { type: "text", text: "Main Street Pharmacy" },
  ...overrides,
});

export const answersNo = (overrides: ClientAnswers = {}): ClientAnswers => ({
  itm_01: { type: "single_choice", optionId: "no" },
  itm_04: { type: "text", text: "Main Street Pharmacy" },
  ...overrides,
});

export function startSession(app: FastifyInstance, questionnaireId: string = INTAKE_QUESTIONNAIRE_ID) {
  return app.inject({ method: "POST", url: executionUrl("/sessions"), payload: { questionnaireId } });
}

export function getSession(app: FastifyInstance, sessionId: string) {
  return app.inject({ method: "GET", url: executionUrl(`/sessions/${sessionId}`) });
}

export function submit(app: FastifyInstance, sessionId: string, answers: unknown) {
  return app.inject({ method: "POST", url: executionUrl(`/sessions/${sessionId}/submit`), payload: { answers } as object });
}

export async function startedSessionId(app: FastifyInstance, questionnaireId?: string): Promise<string> {
  const started = await startSession(app, questionnaireId);
  if (started.statusCode !== 201) {
    throw new Error(`session did not start: ${started.statusCode} ${started.body}`);
  }
  return (started.json() as { session: { sessionId: string } }).session.sessionId;
}

export function problemOf(response: LightMyRequestResponse) {
  return response.json() as {
    type: string;
    status: number;
    title: string;
    instance?: string;
    items?: { itemId: string; code: string }[];
    errors?: { pointer: string; code: string }[];
  };
}
