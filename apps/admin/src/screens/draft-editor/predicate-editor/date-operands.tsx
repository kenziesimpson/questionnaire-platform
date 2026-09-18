import type { Condition, ConditionOf } from "@qp/shared";
import { Input } from "@qp/ui/primitives/input";
import { UNSET_DATE, earlierDate, laterDate } from "../conditions";

function DateInput({
  label,
  value,
  describedBy,
  onCommit,
}: {
  label: string;
  value: string;
  describedBy: string | undefined;
  onCommit: (value: string) => void;
}) {
  return (
    <Input
      type="date"
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={value === UNSET_DATE || undefined}
      className="w-40"
      value={value}
      onChange={(event) => {
        if (event.target.value !== UNSET_DATE) onCommit(event.target.value);
      }}
    />
  );
}

export function DateOperands({
  label,
  condition,
  describedBy,
  onChange,
}: {
  label: string;
  condition: ConditionOf<"date">;
  describedBy: string | undefined;
  onChange: (condition: Condition) => void;
}) {
  if (condition.op !== "between") {
    return (
      <DateInput label={label} value={condition.date} describedBy={describedBy} onCommit={(date) => onChange({ ...condition, date })} />
    );
  }
  return (
    <span className="flex gap-2">
      <DateInput
        label={`${label}, earliest`}
        value={condition.min}
        describedBy={describedBy}
        onCommit={(min) => onChange({ ...condition, min, max: laterDate(min, condition.max) })}
      />
      <span className="self-center text-sm text-muted-foreground">and</span>
      <DateInput
        label={`${label}, latest`}
        value={condition.max}
        describedBy={describedBy}
        onCommit={(max) => onChange({ ...condition, max, min: earlierDate(max, condition.min) })}
      />
    </span>
  );
}
