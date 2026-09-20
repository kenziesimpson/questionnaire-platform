# Dynamic Questionnaire Platform

A working prototype of an administrator-authored, versioned questionnaire
platform with conditional branching. See [`docs/2-design-doc.md`](docs/2-design-doc.md)
for the full design (in progress — sections fill in as decisions land) and
[`docs/4-implementation-plan.md`](docs/4-implementation-plan.md) for build status.

> **Status:** a working prototype. Administrators author, preview and publish versioned
> questionnaires with conditional branching; respondents fill them in and submit; administrators
> browse the responses, and each read of a response's raw answers is written to an audit trail.
> Telemetry is built in, with a rule that a respondent's answer never enters it, and an opt-in
> observability stack (a Collector and Grafana) runs beside the app. [`docs/4-implementation-plan.md`](docs/4-implementation-plan.md)
> has what is built and what is still a manual check. Run it below.

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
observability/  The OpenTelemetry Collector's configuration and the Grafana dashboards and alert rules, run by the `observability` Compose profile
db/init/        The script that creates the database roles, and the `pg_stat_statements` setup
e2e/            Playwright specs against the composed stack
tests/          Repo-level tests: lint rules, test placement, the nginx access log, the Compose profile and the dashboards
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
the backend API, and the frontend container — seeded with the demo intake questionnaire. `docker-compose.override.yml` is applied automatically (it's how
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

- **Structured JSON logs** on the backend's stdout, one line per event, with the trace and span id inside a span; with export on, the same lines also leave as OpenTelemetry log records. `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) sets the threshold. Logs are pretty-printed when `NODE_ENV=development`.
- **Health probes:** `/health/live` (the process is up) and `/health/ready` (each database pool answers).
- **A closed field registry.** A log line or span carries only registered fields, whose types cannot hold free text; anything else is dropped and counted. `.claude/skills/telemetry-safety/SKILL.md` says how to add a field or a signal.
- **The sentinel leak test**, which plants a value where an answer would be and fails if it reaches any log, span, metric or exported log record. Run it with `npm run test:leak-test`; CI runs it as its own job, "Response telemetry leak test".

OpenTelemetry export is off unless you point the backend at an OTLP/HTTP receiver. Set these in the backend's environment:

| Variable | Effect | Default |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL of the receiver. Traces go to `<endpoint>/v1/traces`, metrics to `<endpoint>/v1/metrics` and logs to `<endpoint>/v1/logs`, all through the scrub. Unset or empty: nothing is exported | unset |
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

- **Grafana:** http://localhost:3001 (the port is `GRAFANA_PORT`). It asks for no login. Explore has the traces, the request and database metrics, and the backend's logs.
- **Dashboards:** Dashboards, folder "Questionnaire platform": Service health, Respondent funnel, Admin and authoring, Database, and Client. They are files under `observability/grafana/dashboards/`, so edit the JSON, not the UI.
- **Alerts:** Alerting, Alert rules, the group "Questionnaire platform, O10": the six alerts, and the group "Questionnaire platform, client": three that only ever ticket, each labelled `severity` `page` or `ticket` and annotated with what to look at first. No contact point is provisioned, so they show in Grafana and notify nobody until you add one under Alerting, Notification policies. Thresholds and reasoning are in [`docs/6-observability.md`](docs/6-observability.md) §8.3.
- **Turning on export:** the backend sends nothing until `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Inside Compose it is `http://collector:4318`; for a backend on the host it is `http://localhost:4318` (the Collector publishes `OTLP_PORT` on `127.0.0.1`). Compose passes `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` and `LOG_LEVEL` to the backend. Set `QP_SERVICE_VERSION` to a commit SHA to stamp each signal with the build; it defaults to `dev`. The plain `docker compose --profile observability up` (with the dev override) works too.
- **Browser tracing** is off unless the frontend image is built with `VITE_TELEMETRY_TRACING=true`, which Compose does not pass: build it with `docker compose -f docker-compose.yml build --build-arg VITE_TELEMETRY_TRACING=true frontend`, then start the profile without `--build`. Without it the browser sends no `traceparent` and a trace starts at the backend. Browser spans are never exported; a trace that came from a browser shows the backend's `request` span with a parent that was never received. H7 in [`docs/4-implementation-plan.md`](docs/4-implementation-plan.md#manual-checkpoints) is the manual check that follows one submit and one admin read through the stack.
- **What the Collector keeps.** Every pipeline that exports has a redaction stage that removes every attribute not on its allowlist; the backend's signals use the telemetry field registry as the allowlist. The request-rate and latency metrics are derived from every span before sampling. Sampling, redaction and the log path are in [`docs/6-observability.md`](docs/6-observability.md) §8.2, §10 and §11.
- **Logs** are emitted by the backend as OpenTelemetry log records, from the same place that writes its stdout lines and after the same scrub, and they carry the trace id of the request they belong to. The Collector reads no file and no container. **nginx's access log** is JSON on the frontend container's stdout (`docker compose logs frontend`): the method, the status, the trace context and the route with session ids masked as `:sessionId`, with a path that is not a plain route logged as `:unmatched` and no query string, so a pagination `cursor` cannot appear. It is not sent to Grafana ([`docs/6-observability.md`](docs/6-observability.md) §11.1, L5).
- **Postgres metrics** are read as `qp_monitor`, a role that can read statistics and no answer table. The `roles` service creates it from `db/init/01-roles.sh` on every `up`.

#### Sampling

The Collector keeps every trace that has an error, every trace longer than `QP_TRACE_SLOW_MS` (default 1000 ms), and `QP_TRACE_SAMPLE_PERCENT` percent of the rest (default 100). It ships at 100 because the prototype's volume is small; lower the percentage as volume grows, and errors and slow traces are still all kept. A health probe that succeeds quickly is never kept; one that fails or is slow is. Set both in `.env` (see `.env.example`); the design is in [`docs/6-observability.md`](docs/6-observability.md) §10.

#### Security

This profile is a single-machine local stack. Grafana runs with anonymous Admin access and the Collector's OTLP port has no authentication. Both are published on `127.0.0.1` only, which is the whole protection (O22). Do not bind either to another address, and do not use this configuration to host anything: a hosted stack needs authentication, TLS and a bind decided by the platform.

`lgtm` takes tens of seconds to accept OTLP and the Collector does not wait for it, so after a cold start the first exports are retried and some may be dropped.

CI builds the default stack but not this profile; a person running the command above is the check for the profile itself. The dashboards and alerts read Prometheus series named by the image's OTLP translation; CI checks them against the names the code produces, and Explore in Grafana confirms them (§11.2).

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Build shared, then every workspace with a `build` script (declaration order: shared → telemetry → admin → backend → respondent) |
| `npm run typecheck` | Typecheck every workspace |
| `npm run test` | Run every workspace's tests |
| `npm run db:generate -w apps/backend` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate -w apps/backend` | Apply migrations as `qp_owner` (needs `DATABASE_URL_OWNER`) |
