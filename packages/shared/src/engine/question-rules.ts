import { OTHER_OPTION_ID, type Option, type QuestionInput } from "../domain/question.js";
import type { QuestionRuleCode } from "../problems.js";

export interface QuestionRuleError {
  pointer: string;
  code: QuestionRuleCode;
}

function exceeds<T extends number | string>(low: T | undefined, high: T | undefined): boolean {
  return low !== undefined && high !== undefined && low > high;
}

function optionErrors(options: readonly Option[]): QuestionRuleError[] {
  const errors: QuestionRuleError[] = [];
  const seen = new Set<string>();
  options.forEach((option, index) => {
    if (seen.has(option.optionId)) errors.push({ pointer: `/options/${index}/optionId`, code: "question/duplicate-option-id" });
    seen.add(option.optionId);
    if (option.freeform === true && option.optionId !== OTHER_OPTION_ID) {
      errors.push({ pointer: `/options/${index}/freeform`, code: "question/freeform-not-other" });
    }
    if (option.optionId === OTHER_OPTION_ID && option.freeform !== true) {
      errors.push({ pointer: `/options/${index}/optionId`, code: "question/other-not-freeform" });
    }
  });
  return errors;
}

export function validateQuestionRules(question: QuestionInput): QuestionRuleError[] {
  switch (question.type) {
    case "text":
      return exceeds(question.minLength, question.maxLength)
        ? [{ pointer: "/minLength", code: "question/min-length-exceeds-max-length" }]
        : [];
    case "single_choice":
      return optionErrors(question.options);
    case "multiple_choice": {
      const errors = optionErrors(question.options);
      if (exceeds(question.minSelections, question.maxSelections)) {
        errors.push({ pointer: "/minSelections", code: "question/min-selections-exceeds-max-selections" });
      }
      if (exceeds(question.minSelections, question.options.length)) {
        errors.push({ pointer: "/minSelections", code: "question/selections-exceed-options" });
      }
      if (exceeds(question.maxSelections, question.options.length)) {
        errors.push({ pointer: "/maxSelections", code: "question/selections-exceed-options" });
      }
      return errors;
    }
    case "number":
      return exceeds(question.min, question.max) ? [{ pointer: "/min", code: "question/min-exceeds-max" }] : [];
    case "date":
      return exceeds(question.min, question.max) ? [{ pointer: "/min", code: "question/min-exceeds-max" }] : [];
  }
}
