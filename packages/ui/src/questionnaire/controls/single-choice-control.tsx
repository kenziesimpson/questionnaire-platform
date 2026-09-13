import type { ClientAnswerValueOf, Option } from "@qp/shared";
import { useFieldIds, type FieldIds } from "../field";
import type { ControlProps } from "../types";
import { useRetainedOtherText } from "./other-text-input";
import { RadioChoiceView } from "./radio-choice-view";

export interface SingleChoiceViewProps {
  ids: FieldIds;
  prompt: string;
  required: boolean;
  error: string | undefined;
  options: readonly Option[];
  selectedOptionId: string | null;
  otherText: string;
  readOnly: boolean;
  onSelect: (optionId: string) => void;
  onOtherTextChange: (optionId: string, text: string) => void;
}

export function singleChoiceAnswer(optionId: string, otherText?: string): ClientAnswerValueOf<"single_choice"> {
  return otherText ? { type: "single_choice", optionId, otherText } : { type: "single_choice", optionId };
}

export function SingleChoiceControl({ item, answer, error, mode, onChange }: ControlProps<"single_choice">) {
  const ids = useFieldIds();
  const { question } = item;
  const readOnly = mode === "readonly";
  const freeformIds = new Set(question.options.filter((option) => option.freeform).map((option) => option.optionId));
  const otherSelected = answer !== undefined && freeformIds.has(answer.optionId);
  const otherText = useRetainedOtherText(otherSelected, answer?.otherText);
  const view: SingleChoiceViewProps = {
    ids,
    prompt: question.prompt,
    required: item.required,
    error,
    options: question.options,
    selectedOptionId: answer?.optionId ?? null,
    otherText,
    readOnly,
    onSelect: (optionId) => {
      if (readOnly || optionId === answer?.optionId) return;
      onChange(item.itemId, singleChoiceAnswer(optionId, freeformIds.has(optionId) ? otherText : undefined));
    },
    onOtherTextChange: (optionId, text) => {
      if (!readOnly) onChange(item.itemId, singleChoiceAnswer(optionId, text));
    },
  };
  return <RadioChoiceView {...view} />;
}
