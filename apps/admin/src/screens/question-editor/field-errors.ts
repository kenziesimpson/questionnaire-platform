import { QUESTION_RULE_CODES, isChoiceQuestion, type PointerError, type QuestionRuleCode, type RequestErrorCode } from "@qp/shared";
import { optionCount, type QuestionForm } from "./question-form";

export type FieldErrors = Record<string, string[]>;

export interface SaveErrors {
  byField: FieldErrors;
  unplaced: string[];
}

export const NO_ERRORS: SaveErrors = { byField: {}, unplaced: [] };

const QUESTION_POINTER_PREFIX = "/body/question";

const RULE_MESSAGES: Record<QuestionRuleCode, string> = {
  "question/min-exceeds-max": "The minimum is above the maximum.",
  "question/min-length-exceeds-max-length": "The minimum length is above the maximum length.",
  "question/min-selections-exceeds-max-selections": "The minimum number of selections is above the maximum.",
  "question/selections-exceed-options": "There are not that many options to select.",
  "question/duplicate-option-id": "Another option already has this id.",
  "question/freeform-not-other": "Only the Other option can be freeform.",
  "question/other-not-freeform": "The id other is reserved for the freeform Other option.",
  "question/type-changed":
    "The response type was fixed when this question was first saved. To ask it with another type, create a new question.",
};

function isQuestionRuleCode(code: RequestErrorCode): code is QuestionRuleCode {
  return QUESTION_RULE_CODES.some((rule) => rule === code);
}

export function messageFor(code: RequestErrorCode): string {
  return isQuestionRuleCode(code) ? RULE_MESSAGES[code] : `The server refused this value (${code}).`;
}

export const optionPointer = (index: number) => `/options/${index}`;

export function fieldPointersOf(form: QuestionForm): string[] {
  const common = ["/type", "/prompt"];
  switch (form.type) {
    case "text":
      return [...common, "/minLength", "/maxLength", "/multiline"];
    case "number":
      return [...common, "/numberKind", "/min", "/max", "/unit"];
    case "date":
      return [...common, "/min", "/max", "/relative"];
    case "single_choice":
    case "multiple_choice": {
      const rows = Array.from({ length: optionCount(form) }, (_, index) => optionPointer(index));
      const selections = form.type === "multiple_choice" ? ["/minSelections", "/maxSelections"] : [];
      return [...common, "/options", ...rows, ...selections];
    }
  }
}

function claimingField(pointer: string, fields: readonly string[]): string | undefined {
  return fields
    .filter((field) => pointer === field || pointer.startsWith(`${field}/`))
    .sort((left, right) => right.length - left.length)[0];
}

function append(errors: FieldErrors, field: string, message: string): FieldErrors {
  return { ...errors, [field]: [...(errors[field] ?? []), message] };
}

export function placeErrors(form: QuestionForm, errors: readonly PointerError[]): SaveErrors {
  const fields = fieldPointersOf(form);
  return errors.reduce<SaveErrors>(({ byField, unplaced }, { pointer, code }) => {
    const message = messageFor(code);
    const relative = pointer.startsWith(QUESTION_POINTER_PREFIX) ? pointer.slice(QUESTION_POINTER_PREFIX.length) : undefined;
    const field = relative === undefined ? undefined : claimingField(relative, fields);
    return field === undefined
      ? { byField, unplaced: [...unplaced, message] }
      : { byField: append(byField, field, message), unplaced };
  }, NO_ERRORS);
}

export function missingEntries(form: QuestionForm): SaveErrors {
  let byField: FieldErrors = {};
  if (form.prompt.trim() === "") byField = append(byField, "/prompt", "Enter the question's prompt.");
  if (isChoiceQuestion(form)) {
    if (optionCount(form) === 0) byField = append(byField, "/options", "Add at least one option.");
    form.options.forEach(({ label }, index) => {
      if (label.trim() === "") byField = append(byField, optionPointer(index), "Enter a label for this option.");
    });
    if (form.otherEnabled && form.otherLabel.trim() === "") {
      byField = append(byField, optionPointer(form.options.length), "Enter a label for the Other option.");
    }
  }
  return { byField, unplaced: [] };
}

export const hasErrors = ({ byField, unplaced }: SaveErrors) => unplaced.length > 0 || Object.keys(byField).length > 0;
