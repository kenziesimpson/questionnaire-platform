import { Input } from "@qp/ui/primitives/input";
import { useId, type ComponentProps } from "react";
import type { FieldErrors } from "../features/question-editor/field-errors";

export function errorIdFor(baseId: string) {
  return `${baseId}-error`;
}

export function FieldMessages({ id, messages }: { id: string; messages: readonly string[] | undefined }) {
  if (messages === undefined || messages.length === 0) return null;
  return (
    <p id={id} className="text-xs leading-snug text-destructive">
      {messages.join(" ")}
    </p>
  );
}

export function describedByFor(errors: FieldErrors, pointer: string, errorId: string, ...others: (string | undefined)[]) {
  const ids = [...others, errors[pointer] === undefined ? undefined : errorId].filter((id) => id !== undefined);
  return ids.length === 0 ? undefined : ids.join(" ");
}

interface InputFieldProps extends Omit<ComponentProps<"input">, "onChange" | "value"> {
  label: string;
  pointer: string;
  errors: FieldErrors;
  value: string;
  onValue: (value: string) => void;
  accepts?: RegExp;
  width?: string;
}

export function InputField({ label, pointer, errors, value, onValue, accepts, width = "w-32", ...input }: InputFieldProps) {
  const id = useId();
  const errorId = errorIdFor(id);
  const invalid = errors[pointer] !== undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${width}`}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedByFor(errors, pointer, errorId)}
        onChange={(event) => {
          const next = event.target.value;
          if (accepts === undefined || accepts.test(next)) onValue(next);
        }}
        {...input}
      />
      <FieldMessages id={errorId} messages={errors[pointer]} />
    </div>
  );
}
