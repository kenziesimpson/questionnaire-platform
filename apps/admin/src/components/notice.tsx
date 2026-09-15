import type { ReactNode } from "react";

export function Notice({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className="flex flex-col items-start gap-3 rounded-xl border border-border px-4 py-6 text-sm"
    >
      {children}
    </div>
  );
}
