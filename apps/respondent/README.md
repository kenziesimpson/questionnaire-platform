# @qp/respondent

The respondent SPA (React + Vite): open a published questionnaire, answer the questions that apply,
resume an incomplete session, and submit. See [`docs/10-frontend.md`](../../docs/10-frontend.md) §4
for the rendering and resume model.

> **Status:** scaffold only. `src/app.tsx` renders a placeholder built from `@qp/ui`. The app itself
> is Wave 3: one URL `/q/:questionnaireId` with a state machine behind it and no router, plain
> `fetch`, TanStack Form, and partial answers in `localStorage`.

## Conventions

- Components and the questionnaire renderer come from [`@qp/ui`](../../packages/ui/README.md). This
  app owns fetching, form state and storage; the renderer owns none of them.
- Stays dependency-light on purpose. It is the anonymous, high-volume surface
  (`docs/10-frontend.md` §8).
- Served at `/` behind nginx in production, with SPA fallback to `/index.html`
  ([`deploy/frontend/nginx.conf`](../../deploy/frontend/nginx.conf)).
- `/api` is proxied to the backend: by nginx in production, by the Vite dev server in development
  (`VITE_API_PROXY_TARGET`, default `http://localhost:3000`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev -w apps/respondent` | Vite dev server on `:5173` |
| `npm run build -w apps/respondent` | Typecheck and build to `dist/` (needs `packages/shared` built) |
| `npm run preview -w apps/respondent` | Serve the built `dist/` locally |
| `npm run typecheck -w apps/respondent` | Typecheck `src/` and `vite.config.ts` |
