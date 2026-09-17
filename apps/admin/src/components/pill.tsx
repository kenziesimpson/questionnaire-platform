import { cn } from "@qp/ui/lib/utils";
import type { ReactNode } from "react";

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 w-fit shrink-0 items-center rounded-full border border-border bg-background px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}
