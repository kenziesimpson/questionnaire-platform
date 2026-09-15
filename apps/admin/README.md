# @qp/admin

The admin SPA (React + Vite): the questionnaire list, draft editor, question bank, version history
and preview. See [`docs/10-frontend.md`](../../docs/10-frontend.md) §5–§6 for the screens and how
authoring concurrency surfaces in the UI.

> **Status:** Track 6 PR0, the skeleton. The shell, the route tree with a stub per screen, the API
> client, the query keys and the optimistic draft-mutation hook are in; the screens are not.

## Layout

| Path | Holds |
| --- | --- |
| `src/router.tsx` | Every route, under the `/admin` basepath. Screen PRs replace their file in `src/screens/`, not this |
| `src/screens/` | One component per screen: `questionnaire-list`, `draft-editor`, `question-bank`, `version-history`, `version-preview` |
| `src/shell/app-shell.tsx` | Header and main navigation around the routed screen |
| `src/api/client.ts` | `callDefinition(route, parts)` over `definitionApi`, and `draftApi` for the four routes that carry the draft `ETag` |
| `src/api/problem-error.ts` | `ProblemError` (the shared `Problem` for its slug), `UnexpectedResponseError`, `isProblem` |
| `src/api/query-keys.ts`, `src/api/queries.ts` | The query keys, and a `queryOptions` factory for every read |
| `src/api/use-draft-mutation.ts` | `useDraftMutation(questionnaireId)`: the only way to write or publish a draft |

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
| `npm run typecheck -w apps/admin` | Typecheck `src/`, `_tests/` and the Vite and Vitest configs |
| `npm run test -w apps/admin` | Vitest and React Testing Library in jsdom; `npm test` at the root runs it too |
