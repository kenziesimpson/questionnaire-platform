import type { Condition, ConditionOf } from "@qp/shared";
import { Input } from "@qp/ui/primitives/input";
import { useId, useState, type KeyboardEvent } from "react";
import { DECIMAL_INPUT_PATTERN } from "../../../lib/input-patterns";
import { lowerOf, upperOf } from "../conditions";

function commitOnEnter(commit: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  };
}

const numberText = (value: number) => (Number.isFinite(value) ? String(value) : "");

function describedByAll(...ids: (string | undefined)[]) {
  const present = ids.filter((id) => id !== undefined);
  return present.length === 0 ? undefined : present.join(" ");
}

function NumberInput({
  label,
  value,
  describedBy,
  onCommit,
}: {
  label: string;
  value: number;
  describedBy: string | undefined;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(numberText(value));
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setText(numberText(value));
      return;
    }
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <Input
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={!Number.isFinite(value) || undefined}
      inputMode="decimal"
      className="w-20"
      value={text}
      onChange={(event) => {
        if (DECIMAL_INPUT_PATTERN.test(event.target.value)) setText(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={commitOnEnter(commit)}
    />
  );
}

function Unit({ id, unit }: { id: string; unit: string | undefined }) {
  return unit === undefined ? null : (
    <span id={id} className="self-center text-sm text-muted-foreground">
      {unit}
    </span>
  );
}

export function NumberOperands({
  label,
  condition,
  unit,
  describedBy,
  onChange,
}: {
  label: string;
  condition: ConditionOf<"number">;
  unit: string | undefined;
  describedBy: string | undefined;
  onChange: (condition: Condition) => void;
}) {
  const unitId = useId();
  const description = describedByAll(unit === undefined ? undefined : unitId, describedBy);
  if (condition.op !== "between") {
    return (
      <span className="flex gap-2">
        <NumberInput
          key={condition.value}
          label={label}
          value={condition.value}
          describedBy={description}
          onCommit={(value) => onChange({ ...condition, value })}
        />
        <Unit id={unitId} unit={unit} />
      </span>
    );
  }
  return (
    <span className="flex gap-2">
      <NumberInput
        key={`min-${condition.min}`}
        label={`${label}, lowest`}
        value={condition.min}
        describedBy={description}
        onCommit={(min) => onChange({ ...condition, min, max: upperOf(min, condition.max) })}
      />
      <span className="self-center text-sm text-muted-foreground">and</span>
      <NumberInput
        key={`max-${condition.max}`}
        label={`${label}, highest`}
        value={condition.max}
        describedBy={description}
        onCommit={(max) => onChange({ ...condition, max, min: lowerOf(max, condition.min) })}
      />
      <Unit id={unitId} unit={unit} />
    </span>
  );
}
