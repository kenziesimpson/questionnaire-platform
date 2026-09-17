# AGENTS.md

Instructions for coding agents working in this repository.

## Read first

- `.claude/skills/questionnaire-assignment/SKILL.md` — scope, quality bar and the decisions already made.
- `.claude/skills/database/SKILL.md` — before touching schema, migrations, repositories or seeds.
- `docs/4-implementation-plan.md` — the build plan. Its **Standing rules** and **Stop and ask** sections are binding. Its **File ownership** section is deprecated; see [[11-structural-refactor#2. File ownership during the pass]] for current ownership.
- `docs/2-design-doc.md` — the design index and the Decisions Log. Never invent a decision; if a load-bearing one is missing, stop and ask.

## Writing

Clarity and concision are the top priorities in everything you write: docs, PR descriptions, commit messages, review comments and replies to the user.

- **Lead with the answer.** State the conclusion, result or recommendation first. Add context only if the reader needs it.
- **Cut what doesn't carry meaning.** No preamble, no restating the question, no recap of what you just did, no closing summary of what you already said.
- **Commit to a position.** Give a recommendation, not a survey of options. Hedge only when the uncertainty is real, and then say exactly what is uncertain.
- **Use plain words and short sentences.** Prefer a concrete example over an abstract description.
- **Keep it short.** If a sentence can be deleted without losing information, delete it.

## Workflow

Make every change on a git worktree, never directly in the checkout you started in and never directly on `main`:

```bash
git worktree add ../qp-<short-task-name> -b <branch-name> main
```

Commit and push from the worktree, then open a PR — `main` only changes by merging one. Multiple agent sessions run against this repo concurrently; editing the shared working copy in place risks clobbering another session's work. The git stash stack is shared across worktrees, so avoid bare `git stash` / `git stash pop`; make a temporary WIP commit instead if you need to set work aside.

## Pull requests

### Screenshots on UI changes

A pull request that changes what `apps/admin`, `apps/respondent` or `packages/ui` renders carries screenshots in its description. Show every screen or component state it adds or changes, including loading, empty, error and conflict states. Capture at 1280px wide, and also at 390px for respondent screens.

- **Capture from the running app** against the real backend (`docker compose up`, or the dev servers with the backend running), not from a test render. Use Playwright with Chromium for states that need interaction, such as an open dialog, a rejected submit or a `409`. Run `npx playwright install chromium` once; keep the capture script in your scratchpad and do not commit it.
- **Never commit screenshots to the pull request's branch.** Push them to the orphan `pr-screenshots` branch as `pr-<number>/<screen>-<state>.png`. If the push is rejected because another agent pushed first, fetch, rebase and push again.
- **Link each image by its blob URL,** which renders for anyone with access to the repository: `![<caption>](https://github.com/kenziesimpson/questionnaire-platform/blob/pr-screenshots/pr-<number>/<file>.png?raw=true)`. Open the pull request first so the number exists, then add the images with `gh pr edit --body`.
- **Lay them out** under a `## Screenshots` heading, with one subheading per screen and a one-line caption per image naming the state.
- **Recapture on every push that changes what renders**, including pushes that address review feedback. Retake each affected screenshot, delete any that no longer match the UI so no stale image remains, and update the description's screenshots and summary in the same round. A review change is not done until its screenshots are.
- **Screenshots come before local validation.** After a change that affects what renders, push the code, capture and push the screenshots, and update the description. Only then run `lint`, `typecheck`, `npm test` and `build`. Reviewers see the new UI while the checks run, and a failing check means a follow-up push, not missing images. For a change confined to one app, running that app's and `packages/ui`'s test projects locally is enough; CI runs the full suite.

## Commands

| Task | Command |
| --- | --- |
| Every test suite | `npm test` |
| Typecheck every workspace | `npm run typecheck` |
| Lint, including the import boundaries | `npm run lint` |
| Build | `npm run build` |

CI (`.github/workflows/ci.yml`) runs all four on every push to `main` and every pull request. A PR is not ready for review until its Checks job is green.

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
- The boundary reaches the db layer: `src/modules/execution` never imports `src/db/definition`, `src/db/seed` or `src/db/audit`, and `src/db/definition` never imports anything under `src/modules`. ESLint rejects both.
- Respondent answer values never reach a log, span, metric or error body. Wrap them in `Sensitive<T>`.
- Never cast through `unknown` or `any` (`x as unknown as T`). ESLint warns on it. Fix the types instead; if the cast is genuinely unavoidable (a third-party type that is wrong, an environment global the package cannot type), disable that one line with the reason: `// eslint-disable-next-line no-restricted-syntax -- <reason>`.
- Never write raw SQL in `apps/backend`: build queries with drizzle's query builder (`eq`, `and`, `exists`, `notExists`, `max`, `inArray`, …). ESLint warns on the `sql` template and `sql.*` calls everywhere except `src/db/schema.ts`. Where Postgres needs something the builder cannot express — calling a database function, DDL, a JSONB function — disable that one statement with the reason.

### Migrations

- Never edit, regenerate or squash a committed migration in `apps/backend/drizzle/`; write a new one. `0000_schema.sql` carries hand edits drizzle-kit cannot express and will silently drop — see [Hand-edited migrations](apps/backend/README.md#hand-edited-migrations) in the backend README before running `db:generate`.

### Tests

Tests are written with the feature, not after. Add one row per case to `docs/8-testing.md` §7 — the only file under `docs/` a build track may edit.

Every package keeps its tests in a `_tests/` directory at the package root, mirroring `src/`'s layout: a test for `src/domain/answer.ts` lives at `_tests/domain/answer.test.ts`, not beside the source file. `_tests/` is included in the package's typecheck config and excluded from its build config.
