import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function Icon({
  size,
  strokeWidth = 2,
  children,
  className,
}: {
  size: number;
  strokeWidth?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function LockIcon({ size = 14, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect width="16" height="10" x="4" y="11" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  );
}

export function RemoveIcon({ size = 13 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

export function PlusIcon({ size = 13 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  );
}

export function ArrowLeftIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size} strokeWidth={1.8}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Icon>
  );
}

export function ChevronDownIcon({ size = 12, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function AlertCircleIcon({ size = 18, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </Icon>
  );
}

export function InfoIcon({ size = 14, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Icon>
  );
}

export function CheckIcon({ size = 12, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function ArrowRightIcon({ size = 14, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  );
}

export function SpinnerIcon({ size = 14, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </Icon>
  );
}

export function RulesIcon({ size = 13 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Icon>
  );
}

export function LogoIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size} strokeWidth={1.8}>
      <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10" />
      <path d="M9 8h5" />
      <path d="M9 12h5" />
      <path d="m17 14 2 2 4-4" />
    </Icon>
  );
}

export function ListIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size} strokeWidth={1.8}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </Icon>
  );
}

export function BookIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size} strokeWidth={1.8}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </Icon>
  );
}

export function LinkIcon({ size = 13, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Icon>
  );
}

export function ArchiveIcon({ size = 13, className }: IconProps) {
  return (
    <Icon size={size} className={className}>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
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
