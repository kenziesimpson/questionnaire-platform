# @qp/admin

The admin SPA (React + Vite): the questionnaire list, draft editor, question bank, version history
and preview. See [`docs/10-frontend.md`](../../docs/10-frontend.md) §5–§6 for the screens and how
authoring concurrency surfaces in the UI.

> **Status:** scaffold only. `src/app.tsx` renders a placeholder built from `@qp/ui`. The five screens
> are Wave 3: code-based TanStack Router, TanStack Query, hand-rolled form state, and dnd-kit
> reordering through the draft `If-Match` ETag.

## Conventions

- Built with `base: '/admin/'`. Without it, asset URLs resolve against the root and the page loads
  blank behind nginx. Served at `/admin/` with SPA fallback to `/admin/index.html`
  ([`deploy/frontend/nginx.conf`](../../deploy/frontend/nginx.conf)).
- Shared components and the preview renderer come from [`@qp/ui`](../../packages/ui/README.md).
  `components.json` here is the entry point for the shadcn CLI: `npx shadcn add <name> -c apps/admin`
  writes shared components into `packages/ui/src/primitives/` and admin-only ones into
  `src/components/` (the `@/` alias).
- `/api` is proxied to the backend: by nginx in production, by the Vite dev server in development
  (`VITE_API_PROXY_TARGET`, default `http://localhost:3000`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev -w apps/admin` | Vite dev server on `:5174`, at `/admin/` |
| `npm run build -w apps/admin` | Typecheck and build to `dist/` (needs `packages/shared` built) |
| `npm run preview -w apps/admin` | Serve the built `dist/` locally |
| `npm run typecheck -w apps/admin` | Typecheck `src/` and `vite.config.ts` |
