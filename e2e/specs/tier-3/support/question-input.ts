import { type Question, type QuestionInput } from "@qp/shared";
import { uniqueName, type DefinitionApi } from "../../../fixtures/index.ts";

export const YES_NO_OPTION_IDS = { yes: "yes", no: "no" } as const;

export function yesNoQuestionInput(label: string): Extract<QuestionInput, { type: "single_choice" }> {
  return {
    type: "single_choice",
    prompt: uniqueName(label),
    options: [
      { optionId: YES_NO_OPTION_IDS.yes, label: "Yes" },
      { optionId: YES_NO_OPTION_IDS.no, label: "No" },
    ],
  };
}

export function textQuestionInput(label: string): Extract<QuestionInput, { type: "text" }> {
  return { type: "text", prompt: uniqueName(label) };
}

export async function createTextQuestions(api: DefinitionApi, labels: readonly string[]): Promise<Question[]> {
  return Promise.all(labels.map((label) => api.createQuestion(textQuestionInput(label))));
}

export function promptOf(question: Question): string {
  return question.latest.prompt;
}
