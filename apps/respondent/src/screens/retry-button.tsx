import { Button } from "@qp/ui/primitives/button";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface RetryControl {
  readonly attempt: number;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}

export interface NewSessionControl {
  readonly starting: boolean;
  readonly onStart: () => void;
}

type ActionVariant = "default" | "outline";

interface ActionButtonProps {
  readonly label: string;
  readonly pendingLabel: string;
  readonly icon: ReactNode;
  readonly pending: boolean;
  readonly blocked: boolean;
  readonly onAction: () => void;
  readonly variant: ActionVariant;
  readonly describedBy: string;
  readonly focusOnMount: boolean;
}

function ActionButton({ label, pendingLabel, icon, pending, blocked, onAction, variant, describedBy, focusOnMount }: ActionButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [focusWhenMounted] = useState(focusOnMount);
  const unavailable = pending || blocked;

  useEffect(() => {
    if (focusWhenMounted) ref.current?.focus();
  }, [focusWhenMounted]);

  return (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size="lg"
      aria-disabled={unavailable || undefined}
      aria-describedby={describedBy}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (!unavailable) onAction();
      }}
    >
      <svg
        aria-hidden="true"
        className={pending ? "motion-safe:animate-spin" : undefined}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {pending ? <path d="M21 12a9 9 0 1 1-6.22-8.56" /> : icon}
      </svg>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export interface RetryButtonProps {
  readonly retry: RetryControl;
  readonly describedBy: string;
  readonly focusOnMount: boolean;
  readonly variant?: ActionVariant;
  readonly blocked?: boolean;
}

export function RetryButton({ retry, describedBy, focusOnMount, variant = "outline", blocked = false }: RetryButtonProps) {
  return (
    <ActionButton
      label="Try again"
      pendingLabel="Trying again…"
      icon={
        <>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </>
      }
      pending={retry.retrying}
      blocked={blocked}
      onAction={retry.onRetry}
      variant={variant}
      describedBy={describedBy}
      focusOnMount={focusOnMount}
    />
  );
}

export interface NewSessionButtonProps {
  readonly newSession: NewSessionControl;
  readonly describedBy: string;
  readonly blocked: boolean;
}

export function NewSessionButton({ newSession, describedBy, blocked }: NewSessionButtonProps) {
  return (
    <ActionButton
      label="Start a new session"
      pendingLabel="Starting a new session…"
      icon={
        <>
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </>
      }
      pending={newSession.starting}
      blocked={blocked}
      onAction={newSession.onStart}
      variant="outline"
      describedBy={describedBy}
      focusOnMount={false}
    />
  );
}
