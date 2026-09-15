import type { ReactNode } from "react";

export interface Segment<V extends string> {
  value: V;
  label: string;
}

interface SegmentedControlProps<V extends string> {
  legend: string;
  name: string;
  value: V;
  segments: readonly Segment<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  describedBy?: string;
  legendClassName?: string;
  trailing?: ReactNode;
}

export function SegmentedControl<V extends string>({
  legend,
  name,
  value,
  segments,
  onChange,
  disabled = false,
  describedBy,
  legendClassName = "text-xs font-medium text-muted-foreground",
  trailing,
}: SegmentedControlProps<V>) {
  return (
    <fieldset aria-describedby={describedBy} className="flex min-w-0 flex-col gap-1.5">
      <legend className={`mb-1.5 ${legendClassName}`}>{legend}</legend>
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className={`inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5 ${disabled ? "opacity-60" : ""}`}
        >
          {segments.map((segment) => (
            <label
              key={segment.value}
              className="relative inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-[0.8rem] whitespace-nowrap text-muted-foreground select-none has-checked:bg-background has-checked:font-medium has-checked:text-foreground has-checked:shadow-xs has-disabled:cursor-not-allowed has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={segment.value}
                checked={segment.value === value}
                disabled={disabled}
                onChange={() => onChange(segment.value)}
              />
              {segment.label}
            </label>
          ))}
        </div>
        {trailing}
      </div>
    </fieldset>
  );
}
