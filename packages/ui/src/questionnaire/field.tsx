import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@qp/ui/lib/utils";
import { Label } from "@qp/ui/primitives/label";

export interface FieldIds {
  base: string;
  control: string;
  legend: string;
  error: string;
  hint: string;
}

export function useFieldIds(): FieldIds {
  const base = useId();
  return { base, control: `${base}-control`, legend: `${base}-legend`, error: `${base}-error`, hint: `${base}-hint` };
}

export function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => Boolean(id));
  return present.length > 0 ? present.join(" ") : undefined;
}

export function errorAria(ids: FieldIds, error: string | undefined, ...otherDescriptions: (string | false | undefined)[]) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(error && ids.error, ...otherDescriptions),
  };
}

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  );
}

export function FieldLabel({ htmlFor, required, children }: { htmlFor: string; required: boolean; children: ReactNode }) {
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {required && <RequiredMark />}
    </Label>
  );
}

export function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {error}
    </p>
  );
}

export function ChoiceFieldset({
  ids,
  prompt,
  required,
  error,
  children,
  className,
  ...fieldsetProps
}: ComponentProps<"fieldset"> & {
  ids: FieldIds;
  prompt: string;
  required: boolean;
  error: string | undefined;
}) {
  return (
    <fieldset
      {...fieldsetProps}
      aria-labelledby={ids.legend}
      className={cn("grid gap-3", className)}
      {...errorAria(ids, error)}
    >
      <legend id={ids.legend} className="mb-3 flex items-center gap-2 text-sm leading-none font-medium">
        {prompt}
        {required && (
          <>
            {" "}
            <RequiredMark />
            <span className="sr-only">(required)</span>
          </>
        )}
      </legend>
      {children}
      <FieldError id={ids.error} error={error} />
    </fieldset>
  );
}
