# @qp/backend

Fastify + TypeScript API for the questionnaire platform: questionnaire definition (authoring,
publishing) and execution (sessions, responses). See
[`docs/2-design-doc.md`](../../docs/2-design-doc.md) §9–§11 for the API and service boundary, and
[`docs/7-application-boundary.md`](../../docs/7-application-boundary.md) for how this app's modules
relate to `packages/shared` and `packages/telemetry`.

> **Status:** scaffold only — `src/index.ts` exposes a `/health` check and nothing else yet.
> `src/modules/definition` and `src/modules/execution` don't exist yet; once they do,
> `eslint.config.mjs` enforces that they never import each other and that only
> `packages/telemetry` imports `pino` or `@opentelemetry/*`.

## Configuration

`src/config.ts` is the single place environment variables are read. Deployment (Docker Compose or
Kubernetes) supplies them as plain environment variables — see `docs/2-design-doc.md` §13
("environment variables only, with a committed `.env.example`; no secrets in images"). See the root
[`.env.example`](../../.env.example) for the full variable list and defaults.

## Database

Postgres via Drizzle ORM (`src/db/`):

- `schema.ts` is intentionally empty scaffolding — the domain schema (questionnaires, questions,
  versions, rules, sessions, responses) depends on decisions tracked in `docs/2-design-doc.md` §5–§7
  and detailed in [`docs/9-database-schema.md`](../../docs/9-database-schema.md). `drizzle-kit
  generate` produces no migrations against it until tables are added.
- `migrate.ts` is a one-shot runner, invoked by the compose `migrate` service, that applies any SQL
  files under `./drizzle` (generated via `npm run db:generate -w apps/backend`) to `DATABASE_URL`
  and exits. It resolves the migrations folder relative to this file rather than `process.cwd()`,
  since the compose `migrate` service runs from the monorepo root (`/app`), not from
  `apps/backend`.
- `seed.ts` is a one-shot runner, invoked by the same compose service after migrations succeed. Once
  the questionnaire schema and authoring service exist, it will insert the mandatory branching demo
  questionnaire (medical-condition yes/no → conditional follow-ups) described in
  `docs/2-design-doc.md`. For now it's a placeholder — there's no schema to seed against yet.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev -w apps/backend` | Fastify on `:3000` with reload (needs a reachable Postgres — see `.env.example`) |
| `npm run build -w apps/backend` | Compile to `dist/` |
| `npm run test -w apps/backend` | Run this package's tests (vitest, `_tests/`) |
| `npm run typecheck -w apps/backend` | Typecheck `src/` and `_tests/` |
| `npm run db:generate -w apps/backend` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate -w apps/backend` | Apply migrations (needs `DATABASE_URL`) |
| `npm run db:seed -w apps/backend` | Run the seed script |
