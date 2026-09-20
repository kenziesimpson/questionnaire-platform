import { Input } from "@qp/ui/primitives/input";
import { Textarea } from "@qp/ui/primitives/textarea";
import { errorAria, FieldError, FieldLabel, useFieldIds } from "../field";
import type { ControlProps } from "../types";

export function TextControl({ item, answer, error, mode, onChange, label }: ControlProps<"text">) {
  const ids = useFieldIds();
  const { question } = item;
  const readOnly = mode === "readonly";
  const shared = {
    id: ids.control,
    value: answer?.text ?? "",
    readOnly,
    "aria-required": item.required || undefined,
    ...errorAria(ids, error),
    onChange: (event: { target: { value: string } }) => {
      if (readOnly) return;
      const text = event.target.value;
      onChange(item.itemId, text ? { type: "text", text } : null);
    },
  };
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor={ids.control} required={item.required}>
        {label ?? question.prompt}
      </FieldLabel>
      {question.multiline ? <Textarea {...shared} /> : <Input type="text" {...shared} />}
      <FieldError id={ids.error} error={error} />
    </div>
  );
}
