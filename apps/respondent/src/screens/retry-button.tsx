import { Button } from "@qp/ui/primitives/button";
import { useEffect, useRef, useState } from "react";

export interface RetryControl {
  readonly attempt: number;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}

export interface RetryButtonProps {
  readonly retry: RetryControl;
  readonly describedBy: string;
  readonly focusOnMount: boolean;
}

export function RetryButton({ retry: { retrying, onRetry }, describedBy, focusOnMount }: RetryButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [focusWhenMounted] = useState(focusOnMount);

  useEffect(() => {
    if (focusWhenMounted) ref.current?.focus();
  }, [focusWhenMounted]);

  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="lg"
      aria-disabled={retrying || undefined}
      aria-describedby={describedBy}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (!retrying) onRetry();
      }}
    >
      <svg
        aria-hidden="true"
        className={retrying ? "motion-safe:animate-spin" : undefined}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
      {retrying ? "Trying again…" : "Try again"}
    </Button>
  );
}
