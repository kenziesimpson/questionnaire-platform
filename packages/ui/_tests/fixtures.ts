import type { ClientAnswers, Item } from "@qp/shared";
import type { QuestionOf, RendererProps } from "../src/questionnaire/types";

export const hasCondition: Item = {
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
};

export const whichCondition: Item = {
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
};

const diagnosedOnQuestion: QuestionOf<"date"> = {
  questionId: "01a0950f-41c2-7435-a65e-c53680e09195",
  questionVersion: 1,
  type: "date",
  prompt: "When were you diagnosed?",
  relative: "not_future",
};

export const diagnosedOn: Item = {
  itemId: "itm_03",
  required: true,
  visibleWhen: { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] },
  question: diagnosedOnQuestion,
};

export const pharmacy: Item = {
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
};

export const answeredNo = [hasCondition, pharmacy];
export const answeredYes = [hasCondition, whichCondition, diagnosedOn, pharmacy];

export function aDateItem({ required = true, ...question }: { required?: boolean } & Partial<QuestionOf<"date">> = {}): Item {
  return { ...diagnosedOn, required, question: { ...diagnosedOnQuestion, ...question } };
}

export const noAnswers: ClientAnswers = {};

export function rendererProps(overrides: Partial<RendererProps> = {}): RendererProps {
  return { answers: noAnswers, errors: {}, onChange: () => {}, mode: "interactive", ...overrides };
}
