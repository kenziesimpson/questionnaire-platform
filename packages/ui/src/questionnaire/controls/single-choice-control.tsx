import { freeformOptionOf, type ClientAnswerValueOf } from "@qp/shared";
import { useFieldIds } from "../field";
import type { ControlProps } from "../types";
import { useRetainedOtherText } from "./other-text-input";
import { RadioChoiceView, type SingleChoiceViewProps } from "./radio-choice-view";

function singleChoiceAnswer(optionId: string, otherText?: string): ClientAnswerValueOf<"single_choice"> {
  return otherText ? { type: "single_choice", optionId, otherText } : { type: "single_choice", optionId };
}

export function SingleChoiceControl({ item, answer, error, mode, onChange, label }: ControlProps<"single_choice">) {
  const ids = useFieldIds();
  const { question } = item;
  const readOnly = mode === "readonly";
  const otherOptionId = freeformOptionOf(question)?.optionId;
  const otherSelected = answer !== undefined && answer.optionId === otherOptionId;
  const otherText = useRetainedOtherText(otherSelected, answer?.otherText);
  const view: SingleChoiceViewProps = {
    ids,
    prompt: label ?? question.prompt,
    required: item.required,
    error,
    options: question.options,
    otherOptionId,
    selectedOptionId: answer?.optionId ?? null,
    otherText,
    readOnly,
    onSelect: (optionId) => {
      if (readOnly || optionId === answer?.optionId) return;
      onChange(item.itemId, singleChoiceAnswer(optionId, optionId === otherOptionId ? otherText : undefined));
    },
    onOtherTextChange: (optionId, text) => {
      if (!readOnly) onChange(item.itemId, singleChoiceAnswer(optionId, text));
    },
  };
  return <RadioChoiceView {...view} />;
}
