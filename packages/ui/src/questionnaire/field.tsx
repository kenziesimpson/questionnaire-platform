import { useId, type ReactNode } from "react";
import { Label } from "@qp/ui/primitives/label";

export interface FieldIds {
  control: string;
  error: string;
}

export function useFieldIds(): FieldIds {
  const base = useId();
  return { control: `${base}-control`, error: `${base}-error` };
}

export function errorAria(ids: FieldIds, error: string | undefined) {
  return error ? { "aria-invalid": true, "aria-describedby": ids.error } : {};
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
