import { freeformOptionOf, optionIdsOf, type Option, type QuestionInput, type QuestionVersion, type ResponseType } from "@qp/shared";
import { NO_OPTION_ID, YES_OPTION_ID, generateOptionId } from "./option-ids";

type NumberQuestion = Extract<QuestionInput, { type: "number" }>;
type DateQuestion = Extract<QuestionInput, { type: "date" }>;

export type NumberKind = NumberQuestion["numberKind"];
export type RelativeDate = NonNullable<DateQuestion["relative"]> | "any";

export interface EditableOption {
  optionId: string;
  label: string;
}

export interface OptionsBeforeYesNo {
  options: EditableOption[];
  otherEnabled: boolean;
}

export interface QuestionForm {
  type: ResponseType;
  prompt: string;
  yesNo: boolean;
  beforeYesNo: OptionsBeforeYesNo | null;
  minLength: string;
  maxLength: string;
  multiline: boolean;
  options: EditableOption[];
  otherEnabled: boolean;
  otherLabel: string;
  minSelections: string;
  maxSelections: string;
  numberKind: NumberKind;
  numberMin: string;
  numberMax: string;
  unit: string;
  dateMin: string;
  dateMax: string;
  relative: RelativeDate;
}

const DEFAULT_OTHER_LABEL = "Other";

const emptyConstraints = {
  minLength: "",
  maxLength: "",
  multiline: false,
  otherEnabled: false,
  otherLabel: DEFAULT_OTHER_LABEL,
  minSelections: "",
  maxSelections: "",
  numberKind: "integer",
  numberMin: "",
  numberMax: "",
  unit: "",
  dateMin: "",
  dateMax: "",
  relative: "any",
  yesNo: false,
  beforeYesNo: null,
} satisfies Omit<QuestionForm, "type" | "prompt" | "options">;

export function blankForm(): QuestionForm {
  return {
    ...emptyConstraints,
    type: "text",
    prompt: "",
    options: [blankOption()],
  };
}

export const blankOption = (): EditableOption => ({ optionId: generateOptionId(new Set()), label: "" });

export function isYesNoQuestion(question: QuestionVersion): boolean {
  if (question.type !== "single_choice") return false;
  const ids = optionIdsOf(question).sort();
  return ids.length === 2 && ids[0] === NO_OPTION_ID && ids[1] === YES_OPTION_ID;
}

const textOf = (value: number | undefined) => (value === undefined ? "" : String(value));

function choiceFieldsOf(question: Extract<QuestionVersion, { options: Option[] }>) {
  const other = freeformOptionOf(question);
  return {
    options: question.options.filter((option) => option !== other).map(({ optionId, label }) => ({ optionId, label })),
    otherEnabled: other !== undefined,
    otherLabel: other?.label ?? DEFAULT_OTHER_LABEL,
  };
}

function constraintsOf(question: QuestionVersion): Partial<QuestionForm> {
  switch (question.type) {
    case "text":
      return { minLength: textOf(question.minLength), maxLength: textOf(question.maxLength), multiline: question.multiline ?? false };
    case "single_choice":
      return { ...choiceFieldsOf(question), yesNo: isYesNoQuestion(question) };
    case "multiple_choice":
      return {
        ...choiceFieldsOf(question),
        minSelections: textOf(question.minSelections),
        maxSelections: textOf(question.maxSelections),
      };
    case "number":
      return {
        numberKind: question.numberKind,
        numberMin: textOf(question.min),
        numberMax: textOf(question.max),
        unit: question.unit ?? "",
      };
    case "date":
      return { dateMin: question.min ?? "", dateMax: question.max ?? "", relative: question.relative ?? "any" };
  }
}

export function formFromQuestion(question: QuestionVersion): QuestionForm {
  return { ...blankForm(), options: [], type: question.type, prompt: question.prompt, ...constraintsOf(question) };
}

export function parsed(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function optionCount(form: QuestionForm): number {
  return form.options.length + (form.otherEnabled ? 1 : 0);
}
