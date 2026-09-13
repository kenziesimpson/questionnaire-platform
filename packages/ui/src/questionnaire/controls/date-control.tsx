import { Input } from "@qp/ui/primitives/input";
import { errorAria, FieldError, FieldLabel, useFieldIds } from "../field";
import type { ControlProps } from "../types";

export function DateControl({ item, answer, error, mode, onChange }: ControlProps<"date">) {
  const ids = useFieldIds();
  const { question } = item;
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor={ids.control} required={item.required}>
        {question.prompt}
      </FieldLabel>
      <Input
        id={ids.control}
        type="date"
        className="w-auto"
        value={answer?.date ?? ""}
        min={question.min}
        max={question.max}
        readOnly={mode === "readonly"}
        aria-required={item.required || undefined}
        {...errorAria(ids, error)}
        onChange={(event) => {
          if (mode === "readonly") return;
          const date = event.target.value;
          onChange(item.itemId, date ? { type: "date", date } : null);
        }}
      />
      <FieldError id={ids.error} error={error} />
    </div>
  );
}
