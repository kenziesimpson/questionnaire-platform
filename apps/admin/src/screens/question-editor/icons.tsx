import type { ReactNode } from "react";

function Icon({ size, children, className }: { size: number; children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function LockIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <Icon size={size} className={className}>
      <rect width="16" height="10" x="4" y="11" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  );
}

export function InfoIcon() {
  return (
    <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Icon>
  );
}

export function RemoveIcon() {
  return (
    <Icon size={13}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

export function PlusIcon() {
  return (
    <Icon size={13}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  );
}

export function GripIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
