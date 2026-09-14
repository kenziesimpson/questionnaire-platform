import type { ReactNode } from "react";

export function ScreenStub({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">Not built yet.</p>
      {children}
    </section>
  );
}
