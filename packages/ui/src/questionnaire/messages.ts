import { freeformOptionOf, type QuestionContent, type QuestionOf, type SubmissionItemCode } from "@qp/shared";

export const CODES_WITHOUT_A_RENDERED_ITEM = ["answer/not-visible", "answer/unknown-item"] as const;

type CodeWithoutARenderedItem = (typeof CODES_WITHOUT_A_RENDERED_ITEM)[number];

export type RenderedItemErrorCode = Exclude<SubmissionItemCode, CodeWithoutARenderedItem>;

type MessageFor = (question: QuestionContent) => string;

function asType<T extends QuestionContent["type"]>(question: QuestionContent, type: T): QuestionOf<T> | undefined {
  return question.type === type ? (question as QuestionOf<T>) : undefined;
}

function otherLabel(question: QuestionContent): string {
  return freeformOptionOf(question)?.label ?? "Other";
}

function withUnit(value: number, unit: string | undefined): string {
  return unit ? `${value} ${unit}` : String(value);
}

function numberRange(question: QuestionContent): string {
  const number = asType(question, "number");
  const show = (value: number) => withUnit(value, number?.unit);
  if (number?.min !== undefined && number.max !== undefined) return `Enter a number between ${show(number.min)} and ${show(number.max)}.`;
  if (number?.min !== undefined) return `Enter a number of at least ${show(number.min)}.`;
  if (number?.max !== undefined) return `Enter a number no greater than ${show(number.max)}.`;
  return "Enter a number in the allowed range.";
}

function dateRange(question: QuestionContent): string {
  const date = asType(question, "date");
  if (date?.min !== undefined && date.max !== undefined) return `Enter a date between ${date.min} and ${date.max}.`;
  if (date?.min !== undefined) return `Enter a date on or after ${date.min}.`;
  if (date?.max !== undefined) return `Enter a date on or before ${date.max}.`;
  return "Enter a date in the allowed range.";
}

export const ITEM_ERROR_MESSAGES: { readonly [C in RenderedItemErrorCode]: MessageFor } = {
  "answer/required": () => "Answer this question.",
  "answer/type-mismatch": () => "This answer does not fit the question. Answer it again.",
  "text/too-short": (question) => {
    const min = asType(question, "text")?.minLength;
    return min === undefined ? "This answer is too short." : `Enter at least ${min} characters.`;
  },
  "text/too-long": (question) => {
    const max = asType(question, "text")?.maxLength;
    return max === undefined ? "This answer is too long." : `Enter no more than ${max} characters.`;
  },
  "choice/unknown-option": () => "Choose one of the listed options.",
  "choice/duplicate-option": () => "Choose each option only once.",
  "choice/too-few": (question) => {
    const min = asType(question, "multiple_choice")?.minSelections;
    return min === undefined ? "Choose more options." : `Choose at least ${min} ${min === 1 ? "option" : "options"}.`;
  },
  "choice/too-many": (question) => {
    const max = asType(question, "multiple_choice")?.maxSelections;
    return max === undefined ? "Choose fewer options." : `Choose no more than ${max} ${max === 1 ? "option" : "options"}.`;
  },
  "choice/other-text-without-other": (question) => `Select "${otherLabel(question)}" to use your own answer, or clear the text.`,
  "choice/other-text-required": (question) => `Enter your answer for "${otherLabel(question)}".`,
  "number/not-integer": () => "Enter a whole number.",
  "number/out-of-range": numberRange,
  "date/out-of-range": dateRange,
  "date/in-future": () => "Enter a date that is not in the future.",
  "date/in-past": () => "Enter a date that is not in the past.",
};

function isRendered(code: SubmissionItemCode): code is RenderedItemErrorCode {
  return !(CODES_WITHOUT_A_RENDERED_ITEM as readonly SubmissionItemCode[]).includes(code);
}

export function itemErrorMessage(codes: readonly SubmissionItemCode[] | undefined, question: QuestionContent): string | undefined {
  const code = codes?.find(isRendered);
  return code === undefined ? undefined : ITEM_ERROR_MESSAGES[code](question);
}
