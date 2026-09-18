import { FORMAT_VERSION, type Item, type PublishedDefinition } from "../domain/definition.js";
import { OTHER_OPTION_ID, type QuestionInput } from "../domain/question.js";

export const INTAKE_QUESTIONNAIRE_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";

export const INTAKE_QUESTIONNAIRE_KEY = "qnr_intake";

export const INTAKE_QUESTION_IDS = {
  hasCondition: "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
  whichCondition: "01a0950f-4161-7719-98fb-afa43f4c6232",
  diagnosedOn: "01a0950f-41c2-7435-a65e-c53680e09195",
  pharmacy: "01a0950f-4223-73df-8544-fa8f63877e0b",
} as const;

export type IntakeQuestionRole = keyof typeof INTAKE_QUESTION_IDS;

export const INTAKE_QUESTION_ROLES: readonly IntakeQuestionRole[] = ["hasCondition", "whichCondition", "diagnosedOn", "pharmacy"];

export const INTAKE_QUESTION_KEYS: { readonly [R in IntakeQuestionRole]: string } = {
  hasCondition: "qst_has_condition",
  whichCondition: "qst_which_condition",
  diagnosedOn: "qst_diagnosed_on",
  pharmacy: "qst_pharmacy",
};

export const INTAKE_ITEM_IDS = {
  hasCondition: "itm_01",
  whichCondition: "itm_02",
  diagnosedOn: "itm_03",
  pharmacy: "itm_04",
} as const satisfies { readonly [R in IntakeQuestionRole]: string };

export const INTAKE_OPTION_IDS = {
  yes: "yes",
  no: "no",
  diabetes: "opt_diabetes",
  hypertension: "opt_hyperten",
  other: OTHER_OPTION_ID,
} as const;

export type IntakeOptionId = (typeof INTAKE_OPTION_IDS)[keyof typeof INTAKE_OPTION_IDS];

export type IntakeVersion = 1 | 2;

const HYPERTENSION_LABEL: Record<IntakeVersion, string> = {
  1: "Hypertension",
  2: "High blood pressure (hypertension)",
};

const WHICH_CONDITION_QUESTION_VERSION: Record<IntakeVersion, number> = { 1: 3, 2: 4 };

export const INTAKE_EARLIER_REVISIONS: { readonly [R in IntakeQuestionRole]: readonly QuestionInput[] } = {
  hasCondition: [],
  whichCondition: [
    {
      type: "single_choice",
      prompt: "Which medical condition do you have?",
      options: [
        { optionId: INTAKE_OPTION_IDS.diabetes, label: "Diabetes" },
        { optionId: INTAKE_OPTION_IDS.hypertension, label: HYPERTENSION_LABEL[1] },
      ],
    },
    {
      type: "single_choice",
      prompt: "Which condition?",
      options: [
        { optionId: INTAKE_OPTION_IDS.diabetes, label: "Diabetes" },
        { optionId: INTAKE_OPTION_IDS.hypertension, label: HYPERTENSION_LABEL[1] },
      ],
    },
  ],
  diagnosedOn: [],
  pharmacy: [],
};

function onlyIfHasCondition(): Item["visibleWhen"] {
  return {
    all: [{ type: "single_choice", itemId: INTAKE_ITEM_IDS.hasCondition, op: "is", optionId: INTAKE_OPTION_IDS.yes }],
  };
}

export function intakeDefinition(version: IntakeVersion): PublishedDefinition {
  return {
    formatVersion: FORMAT_VERSION,
    questionnaireId: INTAKE_QUESTIONNAIRE_ID,
    version,
    title: "Patient Intake",
    items: [
      {
        itemId: INTAKE_ITEM_IDS.hasCondition,
        required: true,
        visibleWhen: null,
        question: {
          questionId: INTAKE_QUESTION_IDS.hasCondition,
          questionVersion: 1,
          type: "single_choice",
          prompt: "Do you have a medical condition?",
          options: [
            { optionId: INTAKE_OPTION_IDS.yes, label: "Yes" },
            { optionId: INTAKE_OPTION_IDS.no, label: "No" },
          ],
        },
      },
      {
        itemId: INTAKE_ITEM_IDS.whichCondition,
        required: true,
        visibleWhen: onlyIfHasCondition(),
        question: {
          questionId: INTAKE_QUESTION_IDS.whichCondition,
          questionVersion: WHICH_CONDITION_QUESTION_VERSION[version],
          type: "single_choice",
          prompt: "Which condition?",
          options: [
            { optionId: INTAKE_OPTION_IDS.diabetes, label: "Diabetes" },
            { optionId: INTAKE_OPTION_IDS.hypertension, label: HYPERTENSION_LABEL[version] },
            { optionId: INTAKE_OPTION_IDS.other, label: "Other", freeform: true },
          ],
        },
      },
      {
        itemId: INTAKE_ITEM_IDS.diagnosedOn,
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
        itemId: INTAKE_ITEM_IDS.pharmacy,
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
