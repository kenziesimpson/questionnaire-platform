import type { Condition, ConditionOf, Option } from "@qp/shared";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { NativeSelect } from "@qp/ui/primitives/native-select";
import { useId } from "react";

export type ChoiceCondition = ConditionOf<"single_choice"> | ConditionOf<"multiple_choice">;

function OptionCheckbox({
  label,
  checked,
  disabled,
  onChecked,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChecked: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-1.5">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(next) => onChecked(next === true)} />
      <label htmlFor={id} className="text-sm peer-disabled:opacity-80">
        {label}
      </label>
    </span>
  );
}

export function ChoiceOperand({
  label,
  condition,
  options,
  onChange,
}: {
  label: string;
  condition: ChoiceCondition;
  options: readonly Option[];
  onChange: (condition: Condition) => void;
}) {
  if ("optionId" in condition) {
    const known = options.some(({ optionId }) => optionId === condition.optionId);
    return (
      <NativeSelect
        aria-label={label}
        className="w-full min-w-0"
        value={condition.optionId}
        onChange={(event) => onChange({ ...condition, optionId: event.target.value })}
      >
        {!known && (
          <option value={condition.optionId} disabled>
            {`Unknown option ${condition.optionId}`}
          </option>
        )}
        {options.map(({ optionId, label: optionLabel }) => (
          <option key={optionId} value={optionId}>
            {optionLabel}
          </option>
        ))}
      </NativeSelect>
    );
  }
  const knownIds = options.map((option) => option.optionId);
  const checkedKnown = knownIds.filter((id) => condition.optionIds.includes(id));
  const unknownIds = condition.optionIds.filter((id) => !knownIds.includes(id));
  const toggle = (optionId: string, checked: boolean) => {
    const next = checked ? knownIds.filter((id) => id === optionId || checkedKnown.includes(id)) : checkedKnown.filter((id) => id !== optionId);
    if (next.length > 0) onChange({ ...condition, optionIds: next });
  };
  return (
    <fieldset className="flex min-w-44 flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">
      <legend className="sr-only">{label}</legend>
      {unknownIds.map((optionId) => (
        <OptionCheckbox key={optionId} label="Unknown option" checked disabled onChecked={() => undefined} />
      ))}
      {options.map(({ optionId, label: optionLabel }) => (
        <OptionCheckbox
          key={optionId}
          label={optionLabel}
          checked={checkedKnown.includes(optionId)}
          disabled={checkedKnown.length === 1 && checkedKnown[0] === optionId}
          onChecked={(checked) => toggle(optionId, checked)}
        />
      ))}
    </fieldset>
  );
}
