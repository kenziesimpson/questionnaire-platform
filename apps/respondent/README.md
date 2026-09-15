# @qp/respondent

The respondent SPA (React + Vite): open a published questionnaire, answer the questions that apply,
resume an incomplete session, and submit. See [`docs/10-frontend.md`](../../docs/10-frontend.md) §4
for the rendering and resume model.

> **Status:** Wave 3, Track 7. One URL `/q/:questionnaireId` with a state machine behind it and no
> router, plain `fetch`, TanStack Form, and partial answers in `localStorage`. Start, resume, branching,
> the client pre-check, submit, the receipt and the closed and not-found screens are in; the `422`
> error summary, the `409 session/already-submitted` receipt and network retry are still to come.

## Layout

| Path | Owns |
| --- | --- |
| `src/entry/` | Reading the questionnaire id from the one entry URL |
| `src/session/` | The state machine (`respondent-state.ts`), the side effects that drive it (`respondent-session.ts`) and its React hook |
| `src/answers/` | The client pre-check: the shared validator over the visible answers, against the browser's local date |
| `src/screens/` | One component per screen; the form screen holds TanStack Form around the shared renderer |
| `src/api/` | The execution client; calls never throw |
| `src/storage/` | The `qp:respondent:<questionnaireId>` envelope |

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
| `npm run typecheck -w apps/respondent` | Typecheck `src/`, `_tests/` and both configs |
| `npm run test -w apps/respondent` | Vitest and React Testing Library in jsdom |
