import { Input } from "@qp/ui/primitives/input";
import { errorAria, FieldError, FieldLabel, useFieldIds } from "../field";
import type { ControlProps } from "../types";

export function NumberControl({ item, answer, error, mode, onChange }: ControlProps<"number">) {
  const ids = useFieldIds();
  const { question } = item;
  const readOnly = mode === "readonly";
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor={ids.control} required={item.required}>
        {question.prompt}
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={ids.control}
          type="text"
          inputMode={question.numberKind === "integer" ? "numeric" : "decimal"}
          className="max-w-40"
          value={answer?.value ?? ""}
          readOnly={readOnly}
          aria-required={item.required || undefined}
          {...errorAria(ids, error, question.unit !== undefined && ids.hint)}
          onChange={(event) => {
            if (readOnly) return;
            const value = event.target.value;
            onChange(item.itemId, value ? { type: "number", value } : null);
          }}
        />
        {question.unit !== undefined && (
          <span id={ids.hint} className="text-sm text-muted-foreground">
            {question.unit}
          </span>
        )}
      </div>
      <FieldError id={ids.error} error={error} />
    </div>
  );
}
