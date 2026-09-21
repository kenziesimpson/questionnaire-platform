# Dynamic Questionnaire Platform

A working prototype of an administrator-authored, versioned questionnaire platform with conditional
branching. The design is in [`docs/2-design-doc.md`](docs/2-design-doc.md); build status is in
[`docs/4-implementation-plan.md`](docs/4-implementation-plan.md).

## 1. Setup

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Compose v2). Node.js 24
(see `.nvmrc`) is only needed to run tests outside Docker.

```bash
cp .env.example .env
docker compose up --build
```

This builds and starts Postgres, a one-shot migrate and seed job, the backend and the frontend, with the
demo intake questionnaire seeded. The override file runs both apps in dev mode with hot reload:

- Respondent: http://localhost:5173
- Admin: http://localhost:5174/admin/

For the production-shaped build (nginx serving both compiled apps), use
`docker compose -f docker-compose.yml up --build`, which serves the respondent at http://localhost:8080
and the admin at http://localhost:8080/admin/.

The `.env.example` values are development credentials, chosen so the one command works before you write a
`.env`. A real deployment supplies them from a secret store.

## 2. Tests

```bash
npm install
npm test                # unit and integration tests; Testcontainers starts its own Postgres, so Docker must be running
npm run test:leak-test  # the check that no respondent answer reaches a log, span or metric
npm run test:e2e        # Playwright against the composed stack
npm run lint            # ESLint, then knip
npm run typecheck
```

## 3. Try it end to end

1. **Start the stack with logging.** Add the observability profile and point the backend at the Collector:

   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 \
     docker compose -f docker-compose.yml --profile observability up --build
   ```

   Grafana takes a little while to accept data after a cold start.
2. **Open the admin** at http://localhost:8080/admin/.
3. **Create a questionnaire.** Choose **New questionnaire**, name it and choose **Create questionnaire**. In
   the draft editor, use **Add question** to add a few questions, optionally giving one a condition on an
   earlier answer, then choose **Publish**.
4. **Get the link.** On the questionnaire list, use **Copy link** on your questionnaire. It is
   `http://localhost:8080/q/<questionnaire id>`.
5. **Respond.** Open the link in another tab, answer the questions and submit.
6. **View the response.** Back in the admin list, choose **Responses** for your questionnaire and open the
   response you just submitted.
7. **See it in Grafana** at http://localhost:3001 (no login). In **Explore**, choose the Loki data source and
   query `{service_name="qp-backend"}` to see the backend's logs for the requests above. Answers never
   appear in them. **Dashboards**, folder "Questionnaire platform", has the respondent funnel and service
   health for the same session. More in [`observability/README.md`](observability/README.md).

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
observability/  The Collector configuration, Grafana dashboards and alert rules (see its README)
db/init/        The script that creates the database roles, and the `pg_stat_statements` setup
e2e/            Playwright specs against the composed stack
tests/          Repo-level tests: lint rules, test placement, the nginx access log, the Compose profile and the dashboards
docs/           Design doc, scaling notes, implementation plan, ideation
```

Each app and package has its own README with details specific to it:
[`apps/backend`](apps/backend/README.md), [`apps/respondent`](apps/respondent/README.md),
[`apps/admin`](apps/admin/README.md), [`packages/shared`](packages/shared/README.md),
[`packages/ui`](packages/ui/README.md).
