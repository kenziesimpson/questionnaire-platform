import type { ComponentProps } from "react";
import { ChevronDownIcon } from "./icons";

export function NativeSelect({ className = "", children, ...select }: ComponentProps<"select">) {
  return (
    <span className={`relative inline-flex min-w-0 ${className}`}>
      <select
        className="h-8 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-background py-1 pr-7 pl-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        {...select}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
