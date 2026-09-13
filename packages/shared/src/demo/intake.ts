import { FORMAT_VERSION, type Item, type PublishedDefinition } from "../domain/definition.js";

export const INTAKE_QUESTIONNAIRE_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";

export const INTAKE_QUESTION_IDS = {
  hasCondition: "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
  whichCondition: "01a0950f-4161-7719-98fb-afa43f4c6232",
  diagnosedOn: "01a0950f-41c2-7435-a65e-c53680e09195",
  pharmacy: "01a0950f-4223-73df-8544-fa8f63877e0b",
} as const;

export type IntakeVersion = 1 | 2;

const HYPERTENSION_LABEL: Record<IntakeVersion, string> = {
  1: "Hypertension",
  2: "High blood pressure (hypertension)",
};

const WHICH_CONDITION_QUESTION_VERSION: Record<IntakeVersion, number> = { 1: 3, 2: 4 };

function onlyIfHasCondition(): Item["visibleWhen"] {
  return { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] };
}

export function intakeDefinition(version: IntakeVersion): PublishedDefinition {
  return {
    formatVersion: FORMAT_VERSION,
    questionnaireId: INTAKE_QUESTIONNAIRE_ID,
    version,
    title: "Patient Intake",
    items: [
      {
        itemId: "itm_01",
        required: true,
        visibleWhen: null,
        question: {
          questionId: INTAKE_QUESTION_IDS.hasCondition,
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
        visibleWhen: onlyIfHasCondition(),
        question: {
          questionId: INTAKE_QUESTION_IDS.whichCondition,
          questionVersion: WHICH_CONDITION_QUESTION_VERSION[version],
          type: "single_choice",
          prompt: "Which condition?",
          options: [
            { optionId: "opt_diabetes", label: "Diabetes" },
            { optionId: "opt_hyperten", label: HYPERTENSION_LABEL[version] },
            { optionId: "other", label: "Other", freeform: true },
          ],
        },
      },
      {
        itemId: "itm_03",
        required: true,
        visibleWhen: onlyIfHasCondition(),
        question: {
          questionId: INTAKE_QUESTION_IDS.diagnosedOn,
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
          questionId: INTAKE_QUESTION_IDS.pharmacy,
          questionVersion: 1,
          type: "text",
          prompt: "Preferred pharmacy",
          maxLength: 120,
        },
      },
    ],
  };
}
