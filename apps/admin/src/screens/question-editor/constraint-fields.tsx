import { Checkbox } from "@qp/ui/primitives/checkbox";
import { useId, type ReactNode } from "react";
import { describedByFor, errorIdFor, FieldMessages, InputField } from "./field";
import type { FieldErrors } from "./field-errors";
import { OptionsEditor } from "./options-editor";
import {
  COUNT_PATTERN,
  DECIMAL_INPUT_PATTERN,
  edits,
  type NumberKind,
  type QuestionForm,
  type RelativeDate,
} from "./question-form";
import { SegmentedControl } from "./segmented-control";

interface ConstraintFieldsProps {
  form: QuestionForm;
  errors: FieldErrors;
  onChange: (form: QuestionForm) => void;
  onDraggingChange: (dragging: boolean) => void;
}

type SectionProps = Omit<ConstraintFieldsProps, "onDraggingChange">;

const NUMBER_KINDS = [
  { value: "integer", label: "Whole number" },
  { value: "float", label: "Decimal" },
] as const satisfies readonly { value: NumberKind; label: string }[];

const RELATIVE_DATES = [
  { value: "any", label: "Any" },
  { value: "not_future", label: "Not in the future" },
  { value: "not_past", label: "Not in the past" },
] as const satisfies readonly { value: RelativeDate; label: string }[];

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-4">{children}</div>;
}

function TextFields({ form, errors, onChange }: SectionProps) {
  const multilineId = useId();
  const multilineErrorId = errorIdFor(multilineId);
  return (
    <Row>
      <InputField
        label="Min length"
        pointer="/minLength"
        errors={errors}
        inputMode="numeric"
        accepts={COUNT_PATTERN}
        value={form.minLength}
        onValue={(value) => onChange(edits.minLength(form, value))}
      />
      <InputField
        label="Max length"
        pointer="/maxLength"
        errors={errors}
        inputMode="numeric"
        accepts={COUNT_PATTERN}
        value={form.maxLength}
        onValue={(maxLength) => onChange({ ...form, maxLength })}
        onBlur={() => onChange(edits.commitMaxLength(form))}
      />
      <div className="flex flex-col gap-1.5 self-end pb-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={multilineId}
            checked={form.multiline}
            aria-describedby={describedByFor(errors, "/multiline", multilineErrorId)}
            onCheckedChange={(checked) => onChange({ ...form, multiline: checked === true })}
          />
          <label htmlFor={multilineId} className="text-sm">
            Multiline
          </label>
        </div>
        <FieldMessages id={multilineErrorId} messages={errors["/multiline"]} />
      </div>
    </Row>
  );
}

function SelectionFields({ form, errors, onChange }: SectionProps) {
  return (
    <Row>
      <InputField
        label="Min selections"
        pointer="/minSelections"
        errors={errors}
        inputMode="numeric"
        accepts={COUNT_PATTERN}
        value={form.minSelections}
        onValue={(value) => onChange(edits.minSelections(form, value))}
      />
      <InputField
        label="Max selections"
        pointer="/maxSelections"
        errors={errors}
        inputMode="numeric"
        accepts={COUNT_PATTERN}
        value={form.maxSelections}
        onValue={(value) => onChange(edits.maxSelections(form, value))}
        onBlur={() => onChange(edits.commitMaxSelections(form))}
      />
    </Row>
  );
}

function SegmentErrors({ id, errors, pointer }: { id: string; errors: FieldErrors; pointer: string }) {
  return <FieldMessages id={id} messages={errors[pointer]} />;
}

function NumberFields({ form, errors, onChange }: SectionProps) {
  const kindErrorId = errorIdFor(useId());
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SegmentedControl
          legend="Kind — required"
          name="number-kind"
          value={form.numberKind}
          segments={NUMBER_KINDS}
          describedBy={describedByFor(errors, "/numberKind", kindErrorId)}
          onChange={(numberKind) => onChange({ ...form, numberKind })}
        />
        <SegmentErrors id={kindErrorId} errors={errors} pointer="/numberKind" />
      </div>
      <Row>
        <InputField
          label="Min"
          pointer="/min"
          errors={errors}
          inputMode="decimal"
          accepts={DECIMAL_INPUT_PATTERN}
          value={form.numberMin}
          onValue={(value) => onChange(edits.numberMin(form, value))}
        />
        <InputField
          label="Max"
          pointer="/max"
          errors={errors}
          inputMode="decimal"
          accepts={DECIMAL_INPUT_PATTERN}
          value={form.numberMax}
          onValue={(numberMax) => onChange({ ...form, numberMax })}
          onBlur={() => onChange(edits.commitNumberMax(form))}
        />
        <InputField
          label="Unit"
          pointer="/unit"
          errors={errors}
          value={form.unit}
          onValue={(unit) => onChange({ ...form, unit })}
        />
      </Row>
    </div>
  );
}

function DateFields({ form, errors, onChange }: SectionProps) {
  const relativeErrorId = errorIdFor(useId());
  return (
    <div className="flex flex-col gap-4">
      <Row>
        <InputField
          label="Earliest"
          pointer="/min"
          errors={errors}
          type="date"
          width="w-40"
          value={form.dateMin}
          max={form.dateMax === "" ? undefined : form.dateMax}
          onValue={(value) => onChange(edits.dateMin(form, value))}
        />
        <InputField
          label="Latest"
          pointer="/max"
          errors={errors}
          type="date"
          width="w-40"
          value={form.dateMax}
          min={form.dateMin === "" ? undefined : form.dateMin}
          onValue={(dateMax) => onChange({ ...form, dateMax })}
          onBlur={() => onChange(edits.commitDateMax(form))}
        />
      </Row>
      <div className="flex flex-col gap-1">
        <SegmentedControl
          legend="Relative to today"
          name="date-relative"
          value={form.relative}
          segments={RELATIVE_DATES}
          describedBy={describedByFor(errors, "/relative", relativeErrorId)}
          onChange={(relative) => onChange({ ...form, relative })}
        />
        <SegmentErrors id={relativeErrorId} errors={errors} pointer="/relative" />
      </div>
      <p className="text-xs text-muted-foreground">
        The fixed bounds and the relative rule can both be set; each is checked on its own.
      </p>
    </div>
  );
}

export function ConstraintFields({ form, errors, onChange, onDraggingChange }: ConstraintFieldsProps) {
  switch (form.type) {
    case "text":
      return <TextFields form={form} errors={errors} onChange={onChange} />;
    case "single_choice":
      return <OptionsEditor form={form} errors={errors} onChange={onChange} onDraggingChange={onDraggingChange} />;
    case "multiple_choice":
      return (
        <div className="flex flex-col gap-4">
          <OptionsEditor form={form} errors={errors} onChange={onChange} onDraggingChange={onDraggingChange} />
          <SelectionFields form={form} errors={errors} onChange={onChange} />
        </div>
      );
    case "number":
      return <NumberFields form={form} errors={errors} onChange={onChange} />;
    case "date":
      return <DateFields form={form} errors={errors} onChange={onChange} />;
  }
}
