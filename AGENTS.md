# AGENTS.md

Guidance for AI coding agents working in the Dynamic Questionnaire Platform repo. Read this before touching anything.

## The two hard rules

### 1. Work in a git worktree, never in place

- Never edit files directly in the checkout you started in, and never commit to `main`.
- Before your first edit, create an isolated worktree (or use the one you were handed) and do all work there:
  ```bash
  git worktree add ../qp-<short-task-name> -b <branch-name> main
  ```
- Commit in the worktree, push the branch, open a PR from it. `main` is only ever updated by merging a PR.
- This exists because multiple agent sessions run against this repo concurrently — a stray edit in the shared working copy clobbers someone else's session.
- The git stash stack is shared across worktrees. Don't use bare `git stash`/`git stash pop`; make a temporary WIP commit instead.

### 2. No comments in code you write

- Source and config-as-code in this repo carry **no** comments. That means no `//`, no `#`, no `/* */`, no JSDoc/docstring blocks, no TODO notes — in `.ts`/`.tsx`, Dockerfiles, `docker-compose*.yml`, `nginx.conf`, CI workflows, shell scripts, `drizzle.config.ts`, and anything else that is executed or interpreted.
- Make the code explain itself: precise names, small functions, narrow types, early returns, one responsibility per module.
- If something genuinely needs explaining — a trade-off, a non-obvious constraint, a rejected alternative — it goes in a numbered doc under `docs/`, in the commit message, or in the PR description. Never inline.
- This is not a style preference to be weighed against convenience; treat it as a build requirement. If you find yourself writing a comment, that's a signal to rename something, extract a function, or write a doc paragraph.
- Prose files are exempt: Markdown docs, `README.md`, this file, and pure-data JSON/YAML are documentation, not code. Comment-like content there is fine.

## Repo layout

- `apps/backend` — `@qp/backend`, Fastify + TypeScript API (questionnaire definition + execution). Postgres via Drizzle ORM.
- `apps/frontend` — `@qp/frontend`, React + TypeScript SPA on Vite; nginx serves the compiled build in prod.
- `packages/shared` — `@qp/shared`, types and the rule engine shared by both apps. Anything the branching logic needs on both sides lives here, not duplicated.
- `docs/` — numbered design documents (see below).
- Root: npm workspaces (`packages/*`, `apps/*`), Node 24 (`.nvmrc`), `tsconfig.base.json`, both compose files.

## Commands

Run everything from the repo root unless noted.

- `npm run typecheck` — all workspaces; run this after every change.
- `npm run test` — vitest (currently backend only; add coverage where you add behaviour).
- `npm run build` — builds `shared` → `backend` → `frontend` in that order.
- `npm run lint` — oxlint on the frontend.
- `npm run dev:backend` / `npm run dev:frontend` — single-service dev outside Docker.
- `docker compose up --build` — full stack with hot reload (the override file applies automatically). Frontend on :5173, API proxied at /api.
- `docker compose -f docker-compose.yml up --build` — production-shaped run (nginx, :8080), bypassing the override.
- Database: `npm run db:generate -w apps/backend` (new Drizzle migration), `db:migrate`, `db:seed`. Never hand-edit generated SQL in `apps/backend/drizzle/`.

## Where decisions live

`docs/` is the source of truth for design, not the code and not your chat history:

`1-ideation` · `2-design-doc` · `3-scaling` · `4-implementation-plan` · `5-questionnaire-format` · `6-observability` · `7-application-boundary` · `8-testing` · `9-database-schema` · `10-frontend`

- Consult the relevant doc before implementing; `docs/4-implementation-plan.md` says what is being built next and in what order.
- If you make a decision that contradicts or extends a doc, update that doc in the same PR. Don't re-litigate settled decisions, and don't record new ones only in code.
- `docs/9-database-schema.md` and `docs/5-questionnaire-format.md` are contracts — schema and payload changes must land in both the doc and the code together.

## Conventions

- Status is scaffold stage: most of the domain model, API, and UI don't exist yet. Prefer building the next planned slice end-to-end over speculative abstraction.
- Cross-workspace imports go through the package name (`@qp/shared`), never a relative path into another workspace.
- ESM everywhere (`"type": "module"`); use the workspace's existing tsconfig rather than adding new compiler options.
- Tests sit next to the code as `*.test.ts` (see `apps/backend/src/health.test.ts`) and follow `docs/8-testing.md`.
- Committed `.env.example` values are deliberate development credentials; don't "fix" them, and never add a real secret to the repo or an image.
- Keep PRs scoped to one slice of the implementation plan, with the reasoning in the PR description.
