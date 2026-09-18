# Dynamic Questionnaire Platform

A working prototype of an administrator-authored, versioned questionnaire
platform with conditional branching. See [`docs/2-design-doc.md`](docs/2-design-doc.md)
for the full design (in progress — sections fill in as decisions land) and
[`docs/4-implementation-plan.md`](docs/4-implementation-plan.md) for build status.

> **Status:** repo scaffold only. Domain model, API, and UI are not yet
> implemented — see the implementation plan for what's next.

## Repo layout

```
apps/
  backend/      Fastify + TypeScript API (questionnaire definition + execution)
  respondent/   React + Vite SPA for answering a questionnaire, served at /
  admin/        React + Vite SPA for authoring and publishing, served at /admin/
packages/
  shared/       Types + rule engine shared between the backend and both apps
  ui/           Tailwind + shadcn primitives and the questionnaire renderer, shared by both apps
  telemetry/    The single boundary allowed to import a logging/tracing library
deploy/
  frontend/     The nginx image that serves both app builds and proxies /api to the backend
docs/           Design doc, scaling notes, implementation plan, ideation
```

Each app and package has its own README with details specific to it:
[`apps/backend`](apps/backend/README.md), [`apps/respondent`](apps/respondent/README.md),
[`apps/admin`](apps/admin/README.md), [`packages/shared`](packages/shared/README.md),
[`packages/ui`](packages/ui/README.md). The frontend image is
[`deploy/frontend/Dockerfile`](deploy/frontend/Dockerfile) with
[`deploy/frontend/nginx.conf`](deploy/frontend/nginx.conf): one nginx container serves the respondent
build at `/` and the admin build at `/admin/`, each with its own SPA fallback, and proxies `/api/` to
the backend so the browser stays on one origin.

## Credentials

The committed `.env.example` values and the Compose fallbacks are **development credentials**, chosen
so `docker compose up` works before you have written a `.env`. That is a deliberate trade for the
one-command setup, not an oversight — a real deployment supplies every database credential from a
secret store, and no secret is ever baked into an image. Postgres is published on `127.0.0.1` only, so
the database is reachable with `psql` from your machine and not from the network.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Compose v2)
- Node.js 24 (see `.nvmrc`) — only needed for running things outside Docker

## Run it

```bash
cp .env.example .env
docker compose up --build
```

This builds and runs the full stack — Postgres, a one-shot migrate/seed job,
the backend API, and the frontend container — seeded with the demo questionnaire once
that lands. `docker-compose.override.yml` is applied automatically (it's how
Compose works when the file is present) and switches both app containers to
dev mode with hot reload via bind mounts. The frontend container runs two Vite dev servers, one per
app, and each proxies `/api` itself, so with the plain command above:

- Respondent (Vite dev server): http://localhost:5173
- Admin (Vite dev server): http://localhost:5174/admin/
- Backend health check: http://localhost:5173/api/health (proxied) or directly at http://localhost:3000/health

For the production-shaped build (nginx serving both compiled apps, no dev
tooling) — what a release or CI run would use — bypass the override:

```bash
docker compose -f docker-compose.yml up --build
```

- Respondent: http://localhost:8080
- Admin: http://localhost:8080/admin/
- Backend health check: http://localhost:8080/api/health

## Local development without Docker

```bash
nvm use            # or install Node 24 directly
npm install
npm run dev:backend   # Fastify on :3000 (needs a reachable Postgres — see .env.example)
npm run dev:respondent  # Vite on :5173, proxies /api to :3000
npm run dev:admin       # Vite on :5174 at /admin/, proxies /api to :3000
```

## Tests

```bash
npm test            # every workspace (vitest projects)
```

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Build shared, then every workspace with a `build` script (declaration order: shared → telemetry → admin → backend → respondent) |
| `npm run typecheck` | Typecheck every workspace |
| `npm run test` | Run every workspace's tests |
| `npm run db:generate -w apps/backend` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate -w apps/backend` | Apply migrations as `qp_owner` (needs `DATABASE_URL_OWNER`) |
