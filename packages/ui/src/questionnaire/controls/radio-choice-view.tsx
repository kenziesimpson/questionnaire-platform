import type { Option } from "@qp/shared";
import { Label } from "@qp/ui/primitives/label";
import { RadioGroup, RadioGroupItem } from "@qp/ui/primitives/radio-group";
import { ChoiceFieldset, type FieldIds } from "../field";
import { OtherTextInput } from "./other-text-input";

export interface SingleChoiceViewProps {
  ids: FieldIds;
  prompt: string;
  required: boolean;
  error: string | undefined;
  options: readonly Option[];
  otherOptionId: string | undefined;
  selectedOptionId: string | null;
  otherText: string;
  readOnly: boolean;
  onSelect: (optionId: string) => void;
  onOtherTextChange: (optionId: string, text: string) => void;
}

export function RadioChoiceView({
  ids,
  prompt,
  required,
  error,
  options,
  otherOptionId,
  selectedOptionId,
  otherText,
  readOnly,
  onSelect,
  onOtherTextChange,
}: SingleChoiceViewProps) {
  return (
    <RadioGroup asChild value={selectedOptionId} onValueChange={onSelect} disabled={readOnly}>
      <ChoiceFieldset ids={ids} prompt={prompt} required={required} error={error} className="gap-1">
        {options.map((option) => {
          const id = `${ids.base}-${option.optionId}`;
          return (
            <div key={option.optionId} className="flex min-h-8 items-center gap-3">
              <RadioGroupItem id={id} value={option.optionId} />
              <Label htmlFor={id} className="font-normal">
                {option.label}
              </Label>
              {option.optionId === otherOptionId && (
                <OtherTextInput
                  option={option}
                  value={otherText}
                  readOnly={readOnly}
                  onChange={(text) => onOtherTextChange(option.optionId, text)}
                />
              )}
            </div>
          );
        })}
      </ChoiceFieldset>
    </RadioGroup>
  );
}
