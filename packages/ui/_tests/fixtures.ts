import type { ClientAnswers, Item, QuestionOf } from "@qp/shared";
import { intakeDefinition } from "@qp/shared/demo";
import type { RendererProps } from "../src/questionnaire/types";

export const intakeV1 = intakeDefinition(1);

function intakeItem(itemId: string): Item {
  const item = intakeV1.items.find((candidate) => candidate.itemId === itemId);
  if (!item) throw new Error(`intakeDefinition(1) has no ${itemId}`);
  return item;
}

export const hasCondition = intakeItem("itm_01");
export const whichCondition = intakeItem("itm_02");
export const diagnosedOn = intakeItem("itm_03");
export const pharmacy = intakeItem("itm_04");

export const answeredNo = [hasCondition, pharmacy];
export const answeredYes = [hasCondition, whichCondition, diagnosedOn, pharmacy];

export function aDateItem({ required = true, ...question }: { required?: boolean } & Partial<QuestionOf<"date">> = {}): Item {
  if (diagnosedOn.question.type !== "date") throw new Error("intake itm_03 is no longer a date question");
  return { ...diagnosedOn, required, question: { ...diagnosedOn.question, ...question } };
}

const symptomsQuestion: QuestionOf<"multiple_choice"> = {
  questionId: "01a0950f-4284-7c3e-9d11-1b2f3a4c5d6e",
  questionVersion: 2,
  type: "multiple_choice",
  prompt: "Which symptoms do you have?",
  options: [
    { optionId: "opt_cough", label: "Cough" },
    { optionId: "opt_fever", label: "Fever" },
    { optionId: "other", label: "Other", freeform: true },
  ],
  minSelections: 1,
  maxSelections: 2,
};

export function aSymptomsItem({ required = false }: { required?: boolean } = {}): Item {
  return { itemId: "itm_05", required, visibleWhen: null, question: symptomsQuestion };
}

const weightQuestion: QuestionOf<"number"> = {
  questionId: "01a0950f-42e5-7a1b-8c2d-3e4f5a6b7c8d",
  questionVersion: 1,
  type: "number",
  prompt: "What is your weight?",
  numberKind: "float",
  min: 0,
  max: 300,
  unit: "kg",
};

export function aNumberItem(question: Partial<QuestionOf<"number">> = {}): Item {
  return { itemId: "itm_06", required: true, visibleWhen: null, question: { ...weightQuestion, ...question } };
}

const notesQuestion: QuestionOf<"text"> = {
  questionId: "01a0950f-4346-7f00-9a1b-2c3d4e5f6a7b",
  questionVersion: 1,
  type: "text",
  prompt: "Anything else we should know?",
};

export function aTextItem({ required = false, ...question }: { required?: boolean } & Partial<QuestionOf<"text">> = {}): Item {
  return { itemId: "itm_07", required, visibleWhen: null, question: { ...notesQuestion, ...question } };
}

export const everyType = [hasCondition, whichCondition, diagnosedOn, pharmacy, aSymptomsItem(), aNumberItem(), aTextItem({ multiline: true })];

export const noAnswers: ClientAnswers = {};

export function rendererProps(overrides: Partial<RendererProps> = {}): RendererProps {
  return { answers: noAnswers, errors: {}, onChange: () => {}, mode: "interactive", ...overrides };
}
