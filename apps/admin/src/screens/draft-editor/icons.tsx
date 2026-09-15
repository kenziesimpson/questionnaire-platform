import type { ReactNode } from "react";

function StrokeIcon({ size, children, className }: { size: number; children: ReactNode; className?: string }) {
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

export function ArrowUpIcon() {
  return (
    <StrokeIcon size={13}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </StrokeIcon>
  );
}

export function ArrowDownIcon() {
  return (
    <StrokeIcon size={13}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </StrokeIcon>
  );
}

export function ArrowLeftIcon() {
  return (
    <StrokeIcon size={18}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon size={12} className={className}>
      <path d="m6 9 6 6 6-6" />
    </StrokeIcon>
  );
}

export function AlertCircleIcon({ className }: { className?: string }) {
  return (
    <StrokeIcon size={18} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </StrokeIcon>
  );
}

export function RulesIcon() {
  return (
    <StrokeIcon size={13}>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </StrokeIcon>
  );
}
