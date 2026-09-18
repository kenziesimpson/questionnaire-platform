import { OTHER_OPTION_ID, freeformOptionOf, optionIdsOf, type Option, type QuestionInput, type QuestionVersion, type ResponseType } from "@qp/shared";
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

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  text: "Text",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  number: "Number",
  date: "Date",
};

export const COUNT_PATTERN = /^\d*$/;
export const DECIMAL_INPUT_PATTERN = /^-?\d*\.?\d*$/;

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

const blankOption = (): EditableOption => ({ optionId: generateOptionId(new Set()), label: "" });

function withYesNoChecked(form: QuestionForm): QuestionForm {
  return {
    ...form,
    yesNo: true,
    beforeYesNo: { options: form.options, otherEnabled: form.otherEnabled },
    options: [
      { optionId: YES_OPTION_ID, label: "Yes" },
      { optionId: NO_OPTION_ID, label: "No" },
    ],
    otherEnabled: false,
  };
}

function withYesNoUnchecked(form: QuestionForm): QuestionForm {
  const before = form.beforeYesNo;
  return {
    ...form,
    yesNo: false,
    beforeYesNo: null,
    options: before !== null && before.options.length > 0 ? before.options : [blankOption()],
    otherEnabled: before?.otherEnabled ?? false,
  };
}

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

function parsed(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function isBelow(raw: string, floorRaw: string): boolean {
  const value = parsed(raw);
  const floor = parsed(floorRaw);
  return value !== undefined && floor !== undefined && value < floor;
}

export function optionCount(form: QuestionForm): number {
  return form.options.length + (form.otherEnabled ? 1 : 0);
}

function capToOptionCount(raw: string, count: number): string {
  const value = parsed(raw);
  return value !== undefined && value > count ? String(count) : raw;
}

function withSelectionsCapped(form: QuestionForm): QuestionForm {
  const count = optionCount(form);
  const minSelections = capToOptionCount(form.minSelections, count);
  const maxSelections = capToOptionCount(form.maxSelections, count);
  return { ...form, minSelections, maxSelections: isBelow(maxSelections, minSelections) ? minSelections : maxSelections };
}

const atLeastOne = (raw: string) => (parsed(raw) === 0 ? "1" : raw);

export const edits = {
  type: (form: QuestionForm, type: ResponseType): QuestionForm =>
    ({ ...(form.yesNo && type !== "single_choice" ? withYesNoUnchecked(form) : form), type }),
  yesNo: (form: QuestionForm, checked: boolean): QuestionForm =>
    withSelectionsCapped(checked ? withYesNoChecked(form) : withYesNoUnchecked(form)),
  minLength: (form: QuestionForm, minLength: string): QuestionForm => ({
    ...form,
    minLength,
    maxLength: isBelow(form.maxLength, minLength) ? minLength : form.maxLength,
  }),
  commitMaxLength: (form: QuestionForm): QuestionForm => {
    const maxLength = atLeastOne(form.maxLength);
    return { ...form, maxLength: isBelow(maxLength, form.minLength) ? form.minLength : maxLength };
  },
  minSelections: (form: QuestionForm, minSelections: string): QuestionForm =>
    withSelectionsCapped({ ...form, minSelections }),
  maxSelections: (form: QuestionForm, maxSelections: string): QuestionForm => ({
    ...form,
    maxSelections: capToOptionCount(maxSelections, optionCount(form)),
  }),
  commitMaxSelections: (form: QuestionForm): QuestionForm => {
    const maxSelections = atLeastOne(form.maxSelections);
    return withSelectionsCapped({ ...form, maxSelections: isBelow(maxSelections, form.minSelections) ? form.minSelections : maxSelections });
  },
  numberMin: (form: QuestionForm, numberMin: string): QuestionForm => ({
    ...form,
    numberMin,
    numberMax: isBelow(form.numberMax, numberMin) ? numberMin : form.numberMax,
  }),
  commitNumberMax: (form: QuestionForm): QuestionForm => ({
    ...form,
    numberMax: isBelow(form.numberMax, form.numberMin) ? form.numberMin : form.numberMax,
  }),
  dateMin: (form: QuestionForm, dateMin: string): QuestionForm => ({
    ...form,
    dateMin,
    dateMax: dateMin !== "" && form.dateMax !== "" && form.dateMax < dateMin ? dateMin : form.dateMax,
  }),
  commitDateMax: (form: QuestionForm): QuestionForm => ({
    ...form,
    dateMax: form.dateMin !== "" && form.dateMax !== "" && form.dateMax < form.dateMin ? form.dateMin : form.dateMax,
  }),
  options: (form: QuestionForm, options: EditableOption[]): QuestionForm => withSelectionsCapped({ ...form, options }),
  otherEnabled: (form: QuestionForm, otherEnabled: boolean): QuestionForm => withSelectionsCapped({ ...form, otherEnabled }),
};

export function addOption(form: QuestionForm): { form: QuestionForm; added: string } {
  const taken = new Set([...form.options.map(({ optionId }) => optionId), YES_OPTION_ID, NO_OPTION_ID, OTHER_OPTION_ID]);
  const added = generateOptionId(taken);
  return { form: edits.options(form, [...form.options, { optionId: added, label: "" }]), added };
}

function committed(form: QuestionForm): QuestionForm {
  return [edits.commitMaxLength, edits.commitMaxSelections, edits.commitNumberMax, edits.commitDateMax].reduce(
    (next, commit) => commit(next),
    form,
  );
}

const present = (raw: string) => (raw.trim() === "" ? undefined : raw.trim());

export function serializedOptions(form: QuestionForm): Option[] {
  const regular = form.options.map(({ optionId, label }) => ({ optionId, label }));
  return form.otherEnabled && !form.yesNo ? [...regular, { optionId: OTHER_OPTION_ID, label: form.otherLabel, freeform: true }] : regular;
}

export function questionInputFromForm(draft: QuestionForm): QuestionInput {
  const form = committed(draft);
  const prompt = form.prompt;
  switch (form.type) {
    case "text":
      return {
        type: "text",
        prompt,
        minLength: parsed(form.minLength),
        maxLength: parsed(form.maxLength),
        multiline: form.multiline ? true : undefined,
      };
    case "single_choice":
      return { type: "single_choice", prompt, options: serializedOptions(form) };
    case "multiple_choice":
      return {
        type: "multiple_choice",
        prompt,
        options: serializedOptions(form),
        minSelections: parsed(form.minSelections),
        maxSelections: parsed(form.maxSelections),
      };
    case "number":
      return {
        type: "number",
        prompt,
        numberKind: form.numberKind,
        min: parsed(form.numberMin),
        max: parsed(form.numberMax),
        unit: present(form.unit),
      };
    case "date":
      return {
        type: "date",
        prompt,
        min: present(form.dateMin),
        max: present(form.dateMax),
        relative: form.relative === "any" ? undefined : form.relative,
      };
  }
}
