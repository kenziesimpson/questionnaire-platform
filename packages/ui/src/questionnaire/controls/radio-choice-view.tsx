import { Label } from "@qp/ui/primitives/label";
import { RadioGroup, RadioGroupItem } from "@qp/ui/primitives/radio-group";
import { ChoiceFieldset } from "../field";
import { OtherTextInput } from "./other-text-input";
import type { SingleChoiceViewProps } from "./single-choice-control";

export function RadioChoiceView({
  ids,
  prompt,
  required,
  error,
  options,
  selectedOptionId,
  otherText,
  readOnly,
  onSelect,
  onOtherTextChange,
}: SingleChoiceViewProps) {
  return (
    <RadioGroup asChild value={selectedOptionId} onValueChange={onSelect} disabled={readOnly}>
      <ChoiceFieldset ids={ids} prompt={prompt} required={required} error={error}>
        {options.map((option) => {
          const id = `${ids.base}-${option.optionId}`;
          return (
            <div key={option.optionId} className="flex items-center gap-3">
              <RadioGroupItem id={id} value={option.optionId} />
              <Label htmlFor={id} className="font-normal">
                {option.label}
              </Label>
              {option.freeform && (
                <OtherTextInput
                  option={option}
                  value={selectedOptionId === option.optionId ? otherText : ""}
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
