import { BookCheckIcon, BookIcon, ListIcon } from "@qp/ui/icons";
import { Button } from "@qp/ui/primitives/button";
import { HeadContent, Link, Outlet, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
      <HeadContent />
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <BookCheckIcon size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Questionnaire admin</span>
        </div>
        <span className="text-xs text-muted-foreground">No sign-in in this prototype · authoring surface</span>
      </header>
      <div className="flex flex-1 items-stretch">
        <nav aria-label="Main" className="flex w-50 shrink-0 flex-col gap-1 border-r border-border px-3 py-4">
          <NavLink to="/questionnaires" icon={<ListIcon size={16} strokeWidth={1.8} aria-hidden="true" />}>
            Questionnaires
          </NavLink>
          <NavLink to="/questions" icon={<BookIcon size={16} strokeWidth={1.8} aria-hidden="true" />}>
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
