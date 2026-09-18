import type { ReactNode } from "react";

export function ScreenHeader({
  back,
  title,
  meta,
  trailing,
}: {
  back?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {back}
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        {meta !== undefined && <p className="pl-9 text-sm text-muted-foreground">{meta}</p>}
      </div>
      {trailing}
    </header>
  );
}
