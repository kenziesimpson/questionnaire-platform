import type { ClientAnswerValueOf, Option } from "@qp/shared";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { Label } from "@qp/ui/primitives/label";
import { ChoiceFieldset, useFieldIds } from "../field";
import type { ControlProps } from "../types";
import { OtherTextInput } from "./other-text-input";

export function multipleChoiceAnswer(
  options: readonly Option[],
  selected: ReadonlySet<string>,
  otherText: string | undefined,
): ClientAnswerValueOf<"multiple_choice"> | null {
  const optionIds = options.filter((option) => selected.has(option.optionId)).map((option) => option.optionId);
  const [first, ...rest] = optionIds;
  if (first === undefined) return null;
  const keepsOtherText = otherText && options.some((option) => option.freeform && selected.has(option.optionId));
  return keepsOtherText
    ? { type: "multiple_choice", optionIds: [first, ...rest], otherText }
    : { type: "multiple_choice", optionIds: [first, ...rest] };
}

export function MultipleChoiceControl({ item, answer, error, mode, onChange }: ControlProps<"multiple_choice">) {
  const ids = useFieldIds();
  const { question } = item;
  const readOnly = mode === "readonly";
  const selected = new Set(answer?.optionIds ?? []);
  const otherText = answer?.otherText ?? "";

  function change(nextSelected: Set<string>, nextOtherText: string | undefined) {
    if (!readOnly) onChange(item.itemId, multipleChoiceAnswer(question.options, nextSelected, nextOtherText));
  }

  function toggle(optionId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(optionId);
    else next.delete(optionId);
    change(next, otherText);
  }

  return (
    <ChoiceFieldset ids={ids} prompt={question.prompt} required={item.required} error={error}>
      {question.options.map((option) => {
        const id = `${ids.base}-${option.optionId}`;
        return (
          <div key={option.optionId} className="flex items-center gap-3">
            <Checkbox
              id={id}
              checked={selected.has(option.optionId)}
              disabled={readOnly}
              onCheckedChange={(checked) => toggle(option.optionId, checked === true)}
            />
            <Label htmlFor={id} className="font-normal">
              {option.label}
            </Label>
            {option.freeform && (
              <OtherTextInput
                option={option}
                value={selected.has(option.optionId) ? otherText : ""}
                readOnly={readOnly}
                onChange={(text) => change(new Set(selected).add(option.optionId), text)}
              />
            )}
          </div>
        );
      })}
    </ChoiceFieldset>
  );
}
