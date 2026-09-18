import type { ReactElement, ReactNode } from "react";

export function ScreenLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-8 px-5 py-8 sm:px-6 sm:py-16">{children}</main>;
}

export function ScreenHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {children}
    </div>
  );
}

export function Lead({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm leading-relaxed text-muted-foreground sm:text-base">
      {children}
    </p>
  );
}

export function Aside({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function StatusBadge({ icon }: { icon: ReactElement }) {
  return (
    <div aria-hidden="true" className="flex size-11 items-center justify-center rounded-full border bg-muted">
      {icon}
    </div>
  );
}
