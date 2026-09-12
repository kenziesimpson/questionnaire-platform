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
  backend/    Fastify + TypeScript API (questionnaire definition + execution)
  frontend/   React + TypeScript SPA (Vite), served by nginx in prod
packages/
  shared/     Types + rule engine shared between backend and frontend
docs/         Design doc, scaling notes, implementation plan, ideation
```

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Compose v2)
- Node.js 24 (see `.nvmrc`) — only needed for running things outside Docker

## Run it

```bash
cp .env.example .env
docker compose up --build
```

This builds and runs the full stack — Postgres, a one-shot migrate/seed job,
the backend API, and the frontend — seeded with the demo questionnaire once
that lands. `docker-compose.override.yml` is applied automatically (it's how
Compose works when the file is present) and switches both app containers to
dev mode with hot reload via bind mounts, so with the plain command above:

- Frontend (Vite dev server): http://localhost:5173
- Backend health check: http://localhost:5173/api/health (proxied) or directly at http://localhost:3000/health

For the production-shaped build (nginx serving the compiled SPA, no dev
tooling) — what a release or CI run would use — bypass the override:

```bash
docker compose -f docker-compose.yml up --build
```

- Frontend: http://localhost:8080
- Backend health check: http://localhost:8080/api/health

## Local development without Docker

```bash
nvm use            # or install Node 24 directly
npm install
npm run dev:backend   # Fastify on :3000 (needs a reachable Postgres — see .env.example)
npm run dev:frontend  # Vite on :5173, proxies /api to :3000
```

## Tests

```bash
npm run test        # backend (vitest)
```

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Build shared → backend → frontend |
| `npm run typecheck` | Typecheck every workspace |
| `npm run test` | Run backend tests |
| `npm run db:generate -w apps/backend` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate -w apps/backend` | Apply migrations (needs `DATABASE_URL`) |
