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
observability/  The OpenTelemetry Collector's configuration, run by the `observability` Compose profile
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
- Backend health checks, published directly on the backend's port (the proxies forward only `/api`): http://localhost:3000/health/live, and http://localhost:3000/health/ready, which also checks the database pools

For the production-shaped build (nginx serving both compiled apps, no dev
tooling) — what a release or CI run would use — bypass the override:

```bash
docker compose -f docker-compose.yml up --build
```

- Respondent: http://localhost:8080
- Admin: http://localhost:8080/admin/
- Backend health check: the backend publishes no host port here, so run `docker compose -f docker-compose.yml exec backend node -e "fetch('http://localhost:3000/health/ready').then((r) => console.log(r.status))"`

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

## Telemetry

Answers never enter telemetry: not a log, a span, a metric or an error body. The design is in
[`docs/6-observability.md`](docs/6-observability.md), the package in [`packages/telemetry`](packages/telemetry/README.md),
and the build status by pull request in the [implementation plan](docs/4-implementation-plan.md#wave-3b--observability-and-pipeline).

What runs today:

- **Structured JSON logs** on the backend's stdout, one line per event, with the trace and span id inside a span. `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) sets the threshold. Logs are pretty-printed when `NODE_ENV=development`.
- **Health probes:** `/health/live` (the process is up) and `/health/ready` (each database pool answers).
- **A closed field registry.** A log line or span carries only registered fields, whose types cannot hold free text; anything else is dropped and counted. `.claude/skills/telemetry-safety/SKILL.md` says how to add a field or a signal.
- **The sentinel leak test**, which plants a value where an answer would be and fails if it reaches any log, span or metric. Run it with `npm run test:leak-test`; CI runs it as its own job, "Response telemetry leak test".

OpenTelemetry export is off unless you point the backend at an OTLP/HTTP receiver. Set these in the backend's environment:

| Variable | Effect | Default |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL of the receiver. Traces go to `<endpoint>/v1/traces` and metrics to `<endpoint>/v1/metrics`, both through the scrub. Unset or empty: nothing is exported | unset |
| `OTEL_SERVICE_NAME` | The `service.name` on exported telemetry | `qp-backend` |

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev:backend
```

### Run the observability stack

The `observability` Compose profile adds an OpenTelemetry Collector (`observability/collector.yaml`) and Grafana's `grafana/otel-lgtm`, which stores and shows traces, metrics and logs. It is opt-in: `docker compose up` starts none of it.

```bash
cp .env.example .env
# in .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
docker compose -f docker-compose.yml --profile observability up --build
```

- **Grafana:** http://localhost:3001 (user `admin`, password `admin`; the port is `GRAFANA_PORT`). Explore has the traces, the request and database metrics, and the logs of the backend and nginx.
- **Turning on export:** the backend sends nothing until `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Inside Compose it is `http://collector:4318`; for a backend on the host it is `http://localhost:4318` (the Collector publishes `OTLP_PORT` on `127.0.0.1`). Compose passes `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` and `LOG_LEVEL` to the backend. Set `QP_SERVICE_VERSION` to a commit SHA to stamp each signal with the build; it defaults to `dev`.
- **Use `-f docker-compose.yml`.** The override in the plain command runs the backend with `NODE_ENV=development`, whose pretty-printed logs the Collector does not read, and serves the apps from Vite instead of nginx, so there is no access log. Traces and metrics flow either way.
- **What the Collector keeps.** It removes every attribute that is not in the telemetry field registry before anything reaches the store. It keeps every error trace, every trace of a second or more and 10% of the rest, and derives the request-rate and latency metrics from all spans before it samples. Sampling, the redaction and the log path are in [`docs/6-observability.md`](docs/6-observability.md) §8.2, §10 and §11.
- **Logs** come from Docker's JSON log files (`/var/lib/docker/containers`, mounted read-only), for the backend and the frontend only. On Docker Desktop that path is inside its Linux VM. On Kubernetes the same `file_log` receiver runs as a DaemonSet.
- **nginx's access log** is JSON and carries the method, the status, the trace context and the route with session ids masked as `:sessionId`; a path that is not a plain route is logged as `:unmatched`. It has no query string, so a pagination `cursor` cannot appear in it. The masked paths are listed in [`docs/6-observability.md`](docs/6-observability.md) §11.1.
- **Postgres metrics** are read as `qp_monitor`, a role that can read statistics and no answer table. The `roles` service creates it from `db/init/01-roles.sh` on every `up`.

CI builds the default stack but not this profile; a person running the command above is the check for the profile itself.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Build shared, then every workspace with a `build` script (declaration order: shared → telemetry → admin → backend → respondent) |
| `npm run typecheck` | Typecheck every workspace |
| `npm run test` | Run every workspace's tests |
| `npm run db:generate -w apps/backend` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate -w apps/backend` | Apply migrations as `qp_owner` (needs `DATABASE_URL_OWNER`) |
