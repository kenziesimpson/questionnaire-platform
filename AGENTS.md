# AGENTS.md

Instructions for coding agents working in this repository.

## Read first

- `.claude/skills/questionnaire-assignment/SKILL.md` — scope, quality bar and the decisions already made.
- `.claude/skills/database/SKILL.md` — before touching schema, migrations, repositories or seeds.
- `docs/4-implementation-plan.md` — the build plan. Its **Standing rules**, **File ownership** and **Stop and ask** sections are binding.
- `docs/2-design-doc.md` — the design index and the Decisions Log. Never invent a decision; if a load-bearing one is missing, stop and ask.

## Workflow

Make every change on a git worktree, never directly in the checkout you started in and never directly on `main`:

```bash
git worktree add ../qp-<short-task-name> -b <branch-name> main
```

Commit and push from the worktree, then open a PR — `main` only changes by merging one. Multiple agent sessions run against this repo concurrently; editing the shared working copy in place risks clobbering another session's work. The git stash stack is shared across worktrees, so avoid bare `git stash` / `git stash pop`; make a temporary WIP commit instead if you need to set work aside.

## Commands

| Task | Command |
| --- | --- |
| Every test suite | `npm test` |
| Typecheck every workspace | `npm run typecheck` |
| Lint, including the import boundaries | `npm run lint` |
| Build | `npm run build` |

Node 24 (`.nvmrc`). TypeScript 6 in every workspace.

## Code conventions

### No comments

Comments are forbidden. Good code is self-documenting: names, types and small functions carry the meaning. A comment is a crutch that props up a design that should have been clearer, and it drifts from the code it describes because nothing checks it.

When you feel the need to write one, change the code instead:

- Rename the variable, function or type until the comment is redundant.
- Extract the block into a function whose name says what the comment would have said.
- Encode the constraint in a type so it cannot be violated, rather than describing it.
- Put the reasoning behind a decision in `docs/`, where decisions live — not beside the code.

Tool directives that must be written in comment syntax are not prose comments and are allowed: `// @ts-expect-error — <reason>` in type-level tests, and ESLint or TypeScript pragmas when unavoidable.

### Contracts and boundaries

- Wire shapes are TypeBox schemas in `packages/shared`; derive TypeScript types from them with `Static`, never write a parallel interface.
- `apps/backend/src/modules/definition` and `apps/backend/src/modules/execution` never import each other. Only `packages/telemetry` imports `pino` or `@opentelemetry/*`. Both are enforced by `eslint.config.mjs`.
- Respondent answer values never reach a log, span, metric or error body. Wrap them in `Sensitive<T>`.

### Tests

Tests are written with the feature, not after. Add one row per case to `docs/8-testing.md` §7 — the only file under `docs/` a build track may edit.

Every package keeps its tests in a `_tests/` directory at the package root, mirroring `src/`'s layout: a test for `src/domain/answer.ts` lives at `_tests/domain/answer.test.ts`, not beside the source file. `_tests/` is included in the package's typecheck config and excluded from its build config.
