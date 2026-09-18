import type { Condition, Predicate } from "../../src/domain/condition.js";
import { FORMAT_VERSION, type Item, type PublishedDefinition } from "../../src/domain/definition.js";
import type { QuestionContent, QuestionInput } from "../../src/domain/question.js";

const questionIds = new Map<string, string>();

export function questionIdFor(itemId: string): string {
  const existing = questionIds.get(itemId);
  if (existing) return existing;
  const id = `00000000-0000-4000-8000-${String(questionIds.size + 1).padStart(12, "0")}`;
  questionIds.set(itemId, id);
  return id;
}

export function anItem(
  itemId: string,
  question: QuestionInput,
  placement: { required?: boolean; visibleWhen?: Predicate | null } = {},
): Item {
  const content = { ...question, questionId: questionIdFor(itemId), questionVersion: 1 } as QuestionContent;
  return { itemId, required: placement.required ?? false, visibleWhen: placement.visibleWhen ?? null, question: content };
}

export function aDefinition(items: Item[]): PublishedDefinition {
  return {
    formatVersion: FORMAT_VERSION,
    questionnaireId: "01a0950e-56a0-73d6-b936-4a1e10eff8c0",
    version: 1,
    title: "Fixture",
    items,
  };
}

export const all = (...conditions: Condition[]): Predicate => ({ all: conditions });
export const any = (...conditions: Condition[]): Predicate => ({ any: conditions });

export const questions = {
  text: (extra: { minLength?: number; maxLength?: number } = {}): QuestionInput => ({ type: "text", prompt: "Text", ...extra }),
  yesNo: (): QuestionInput => ({
    type: "single_choice",
    prompt: "Yes or no?",
    options: [
      { optionId: "yes", label: "Yes" },
      { optionId: "no", label: "No" },
    ],
  }),
  single: (): QuestionInput => ({
    type: "single_choice",
    prompt: "Pick one",
    options: [
      { optionId: "a", label: "A" },
      { optionId: "b", label: "B" },
      { optionId: "c", label: "C" },
      { optionId: "other", label: "Other", freeform: true },
    ],
  }),
  multiple: (extra: { minSelections?: number; maxSelections?: number; optionIds?: string[] } = {}): QuestionInput => ({
    type: "multiple_choice",
    prompt: "Pick some",
    options: (extra.optionIds ?? ["a", "b", "c", "other"]).map((optionId) => ({
      optionId,
      label: optionId.toUpperCase(),
      ...(optionId === "other" ? { freeform: true } : {}),
    })),
    ...(extra.minSelections === undefined ? {} : { minSelections: extra.minSelections }),
    ...(extra.maxSelections === undefined ? {} : { maxSelections: extra.maxSelections }),
  }),
  number: (extra: { numberKind?: "integer" | "float"; min?: number; max?: number; unit?: string } = {}): QuestionInput => ({
    type: "number",
    prompt: "How many?",
    numberKind: "float",
    ...extra,
  }),
  date: (extra: { min?: string; max?: string; relative?: "not_future" | "not_past" } = {}): QuestionInput => ({
    type: "date",
    prompt: "When?",
    ...extra,
  }),
};
