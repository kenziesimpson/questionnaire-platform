# @qp/frontend

React + TypeScript SPA (Vite) for the questionnaire platform. Nginx serves the compiled build in
production. See [`docs/10-frontend.md`](../../docs/10-frontend.md) for the design.

## Dev server (`vite.config.ts`)

- `server.watch.usePolling` is on: bind-mounted file events on macOS
  (`docker-compose.override.yml`) can be sluggish or missed, so the dev server polls from the start
  rather than someone having to debug a stale HMR session later. See `docs/2-design-doc.md` §13
  ("Dev loop / hot reload").
- `server.proxy` forwards `/api` to the backend, mirroring what `nginx.conf` does in production so
  the app talks to a single origin either way. It defaults to `http://localhost:3000` for
  `npm run dev` outside Docker; `docker-compose.override.yml` overrides
  `VITE_API_PROXY_TARGET` to the `backend` service's Docker DNS name instead.

## Production (`nginx.conf`)

Serves the built SPA and reverse-proxies `/api` to the backend, keeping the browser single-origin
(no CORS, no build-time API URL) — a stand-in for the ingress/load-balancer routing a real
deployment would do instead (`docs/2-design-doc.md` §13). The SPA-fallback location resolves any
unmatched path to `index.html` so client-side routing works on a hard refresh or direct link.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev -w apps/frontend` | Vite dev server on `:5173`, proxies `/api` to `:3000` |
| `npm run build -w apps/frontend` | Typecheck and build to `dist/` |
| `npm run lint -w apps/frontend` | oxlint |
| `npm run preview -w apps/frontend` | Serve the production build locally |

See the root [README](../../README.md) for running the whole stack with Docker Compose.
