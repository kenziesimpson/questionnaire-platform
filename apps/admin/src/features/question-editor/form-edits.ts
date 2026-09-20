import { OTHER_OPTION_ID, type ResponseType } from "@qp/shared";
import { NO_OPTION_ID, YES_OPTION_ID, generateOptionId } from "./option-ids";
import { blankOption, optionCount, parsed, type EditableOption, type QuestionForm } from "./form-state";

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

function isBelow(raw: string, floorRaw: string): boolean {
  const value = parsed(raw);
  const floor = parsed(floorRaw);
  return value !== undefined && floor !== undefined && value < floor;
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
  optionLabel: (form: QuestionForm, optionId: string, label: string): QuestionForm => ({
    ...form,
    options: form.options.map((option) => (option.optionId === optionId ? { ...option, label } : option)),
  }),
  otherLabel: (form: QuestionForm, otherLabel: string): QuestionForm => ({ ...form, otherLabel }),
};

export function addOption(form: QuestionForm): { form: QuestionForm; added: string } {
  const taken = new Set([...form.options.map(({ optionId }) => optionId), YES_OPTION_ID, NO_OPTION_ID, OTHER_OPTION_ID]);
  const added = generateOptionId(taken);
  return { form: edits.options(form, [...form.options, { optionId: added, label: "" }]), added };
}
