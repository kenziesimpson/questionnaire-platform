import { answerFor, type ClientAnswers, type ClientAnswerValue, type ClientAnswerValueOf, type ResponseRow } from "../domain/answer.js";
import type { Item } from "../domain/definition.js";
import type { Option, QuestionContent } from "../domain/question.js";
import type { ItemError, SubmissionItemCode } from "../problems.js";
import { addDays, type RelativeDateContext } from "./calendar.js";
import { canonicalDecimal, compareDecimalToNumber, isIntegerDecimal } from "./decimal.js";
import { evaluateVisibility, type HasItems } from "./visibility.js";

type QuestionOf<T extends QuestionContent["type"]> = Extract<QuestionContent, { type: T }>;

export type SubmissionValidation =
  | { valid: true; rows: ResponseRow[] }
  | { valid: false; items: ItemError<SubmissionItemCode>[] };

const OTHER_OPTION_ID = "other";

function codePointLength(text: string): number {
  return [...text].length;
}

function textCodes(question: QuestionOf<"text">, answer: ClientAnswerValueOf<"text">): SubmissionItemCode[] {
  const length = codePointLength(answer.text);
  const codes: SubmissionItemCode[] = [];
  if (question.minLength !== undefined && length < question.minLength) codes.push("text/too-short");
  if (question.maxLength !== undefined && length > question.maxLength) codes.push("text/too-long");
  return codes;
}

function hasVisibleCharacter(text: string | undefined): boolean {
  return text !== undefined && /\S/u.test(text);
}

function isFreeformOther(options: readonly Option[], optionIds: readonly string[]): boolean {
  return optionIds.includes(OTHER_OPTION_ID) && options.some((o) => o.optionId === OTHER_OPTION_ID && o.freeform === true);
}

function choiceCodes(
  options: readonly Option[],
  optionIds: readonly string[],
  otherText: string | undefined,
): SubmissionItemCode[] {
  const known = new Set(options.map((o) => o.optionId));
  const codes: SubmissionItemCode[] = [];
  if (optionIds.some((id) => !known.has(id))) codes.push("choice/unknown-option");
  if (new Set(optionIds).size !== optionIds.length) codes.push("choice/duplicate-option");
  const freeformOtherSelected = isFreeformOther(options, optionIds);
  if (otherText !== undefined && !freeformOtherSelected) codes.push("choice/other-text-without-other");
  if (freeformOtherSelected && !hasVisibleCharacter(otherText)) codes.push("choice/other-text-required");
  return codes;
}

function multipleChoiceCodes(
  question: QuestionOf<"multiple_choice">,
  answer: ClientAnswerValueOf<"multiple_choice">,
): SubmissionItemCode[] {
  const codes = choiceCodes(question.options, answer.optionIds, answer.otherText);
  const selected = new Set(answer.optionIds).size;
  if (question.minSelections !== undefined && selected < question.minSelections) codes.push("choice/too-few");
  if (question.maxSelections !== undefined && selected > question.maxSelections) codes.push("choice/too-many");
  return codes;
}

function isOutside(value: string, min: number | undefined, max: number | undefined): boolean {
  const belowMin = min !== undefined && (compareDecimalToNumber(value, min) ?? -1) < 0;
  const aboveMax = max !== undefined && (compareDecimalToNumber(value, max) ?? 1) > 0;
  return belowMin || aboveMax;
}

function numberCodes(question: QuestionOf<"number">, answer: ClientAnswerValueOf<"number">): SubmissionItemCode[] {
  const codes: SubmissionItemCode[] = [];
  if (question.numberKind === "integer" && !isIntegerDecimal(answer.value)) codes.push("number/not-integer");
  if (isOutside(answer.value, question.min, question.max)) codes.push("number/out-of-range");
  return codes;
}

function dateCodes(
  question: QuestionOf<"date">,
  answer: ClientAnswerValueOf<"date">,
  dates: RelativeDateContext,
): SubmissionItemCode[] {
  const codes: SubmissionItemCode[] = [];
  const { date } = answer;
  if ((question.min !== undefined && date < question.min) || (question.max !== undefined && date > question.max)) {
    codes.push("date/out-of-range");
  }
  if (question.relative === "not_future" && date > addDays(dates.today, dates.toleranceDays)) codes.push("date/in-future");
  if (question.relative === "not_past" && date < addDays(dates.today, -dates.toleranceDays)) codes.push("date/in-past");
  return codes;
}

export function validateAnswer(
  question: QuestionContent,
  answer: ClientAnswerValue,
  dates: RelativeDateContext,
): SubmissionItemCode[] {
  switch (question.type) {
    case "text":
      return answer.type === "text" ? textCodes(question, answer) : ["answer/type-mismatch"];
    case "single_choice":
      return answer.type === "single_choice"
        ? choiceCodes(question.options, [answer.optionId], answer.otherText)
        : ["answer/type-mismatch"];
    case "multiple_choice":
      return answer.type === "multiple_choice" ? multipleChoiceCodes(question, answer) : ["answer/type-mismatch"];
    case "number":
      return answer.type === "number" ? numberCodes(question, answer) : ["answer/type-mismatch"];
    case "date":
      return answer.type === "date" ? dateCodes(question, answer, dates) : ["answer/type-mismatch"];
  }
}

function otherTextField(otherText: string | undefined): { otherText?: string } {
  return otherText === undefined ? {} : { otherText };
}

function responseRow(item: Item, answer: ClientAnswerValue): ResponseRow {
  const head = { itemId: item.itemId, questionId: item.question.questionId, questionVersion: item.question.questionVersion };
  switch (answer.type) {
    case "text":
      return { ...head, type: "text", text: answer.text };
    case "single_choice":
      return { ...head, type: "single_choice", optionIds: [answer.optionId], ...otherTextField(answer.otherText) };
    case "multiple_choice":
      return { ...head, type: "multiple_choice", optionIds: [...answer.optionIds], ...otherTextField(answer.otherText) };
    case "number": {
      const unit = item.question.type === "number" ? item.question.unit : undefined;
      return { ...head, type: "number", number: canonicalDecimal(answer.value) ?? answer.value, ...(unit === undefined ? {} : { unit }) };
    }
    case "date":
      return { ...head, type: "date", date: answer.date };
  }
}

export function validateSubmission(
  definition: HasItems,
  answers: ClientAnswers,
  dates: RelativeDateContext,
): SubmissionValidation {
  const shown = evaluateVisibility(definition, answers);
  const errors: ItemError<SubmissionItemCode>[] = [];
  const rows: ResponseRow[] = [];
  const known = new Set<string>();

  for (const item of definition.items) {
    known.add(item.itemId);
    const answer = answerFor(answers, item.itemId);
    const report = (code: SubmissionItemCode) => errors.push({ itemId: item.itemId, code });
    if (!shown.has(item.itemId)) {
      if (answer !== undefined) report("answer/not-visible");
      continue;
    }
    if (answer === undefined) {
      if (item.required) report("answer/required");
      continue;
    }
    const codes = validateAnswer(item.question, answer, dates);
    codes.forEach(report);
    if (codes.length === 0) rows.push(responseRow(item, answer));
  }

  const unknownItemIds = Object.keys(answers)
    .filter((itemId) => !known.has(itemId) && answerFor(answers, itemId) !== undefined)
    .sort();
  for (const itemId of unknownItemIds) errors.push({ itemId, code: "answer/unknown-item" });

  return errors.length === 0 ? { valid: true, rows } : { valid: false, items: errors };
}
