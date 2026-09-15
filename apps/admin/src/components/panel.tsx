import type { ReactNode } from "react";

export function Panel({ children, role }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className="flex flex-col items-center gap-3 rounded-lg border border-border px-6 py-12 text-center">
      {children}
    </div>
  );
}
