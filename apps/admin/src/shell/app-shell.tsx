import { Button } from "@qp/ui/primitives/button";
import { Link, Outlet, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

function LogoIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10" />
      <path d="M9 8h5" />
      <path d="M9 12h5" />
      <path d="m17 14 2 2 4-4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function NavLink({ to, icon, children }: { to: LinkProps["to"]; icon: ReactNode; children: ReactNode }) {
  return (
    <Button
      asChild
      variant="ghost"
      className="justify-start gap-2.5 text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
    >
      <Link to={to}>
        {icon}
        {children}
      </Link>
    </Button>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <LogoIcon />
          <span className="text-sm font-semibold tracking-tight">Questionnaire admin</span>
        </div>
        <span className="text-xs text-muted-foreground">No sign-in in this prototype · authoring surface</span>
      </header>
      <div className="flex flex-1 items-stretch">
        <nav aria-label="Main" className="flex w-50 shrink-0 flex-col gap-1 border-r border-border px-3 py-4">
          <NavLink to="/questionnaires" icon={<ListIcon />}>
            Questionnaires
          </NavLink>
          <NavLink to="/questions" icon={<BookIcon />}>
            Question bank
          </NavLink>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col gap-5 px-6 pt-6 pb-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
