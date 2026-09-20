import { OTHER_OPTION_ID, type Option, type QuestionInput } from "@qp/shared";
import { edits } from "./form-edits";
import { parsed, type QuestionForm } from "./form-state";

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
