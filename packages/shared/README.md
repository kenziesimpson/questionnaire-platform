# @qp/shared

The only code both halves of the backend (definition and execution) and the frontend share
([`docs/7-application-boundary.md`](../../docs/7-application-boundary.md) §3.3): wire types and
schemas, the conditional-branching rule engine, so the client (rendering) and the server
(submit-time authority) evaluate the exact same logic (`docs/2-design-doc.md` §7, §8), and the
stored-snapshot loader, so every reader upgrades and checks a published snapshot the same way.

## Conventions

- Wire shapes are [TypeBox](https://github.com/sinclairzx81/typebox) schemas; derive TypeScript
  types from them with `Static` rather than hand-writing a parallel interface. See `AGENTS.md` at
  the repo root.
- `dependencies` here become a runtime dependency of both `apps/backend` and `apps/frontend` — keep
  this package free of anything either side shouldn't ship (no `pino`, no DOM APIs).

## Layout

| Path | Contents |
| --- | --- |
| `src/primitives.ts` | Shared TypeBox primitives (`Uuid`, `Slug`, `IsoDate`, …) and `strict` |
| `src/domain/` | Questionnaire, question, condition, definition, draft, answer and session schemas; the vocabulary every workspace uses instead of its own copy (`QuestionOf`, `OTHER_OPTION_ID`, `freeformOptionOf`, `conditionsOf`, `OPERATORS_BY_TYPE`, `draftItemOf`, `questionInputOf`, …); `readStoredDefinition`, which upgrades a stored snapshot to the current format and checks it |
| `src/demo/intake.ts` | The seeded demo questionnaire: its definition, ids, keys and bank history. Exported only as `@qp/shared/demo`: the seed and the test fixtures use it, and it is not part of the package API |
| `src/problems.ts` | The closed set of RFC 9457 problem types the API can return |
| `src/sensitive.ts` | `Sensitive<T>`, the wrapper that keeps a respondent's answer values out of logs |
| `src/api/` | Route/schema plumbing and ETag helpers shared by the definition and execution APIs |

`src/index.ts` names every export it re-exports; `export *` is rejected by lint (L8), and a name nothing
outside the package imports is not exported. `definitionApi` and `executionApi` are exposed as
namespaces to keep the two API surfaces distinguishable at the import site.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build -w packages/shared` | Compile to `dist/` (other workspaces import the built output) |
| `npm run dev -w packages/shared` | Rebuild on change, for use alongside `dev:backend`/`dev:frontend` |
| `npm run test -w packages/shared` | Run this package's tests (vitest, `_tests/`) |
| `npm run typecheck -w packages/shared` | Typecheck `src/` and `_tests/` |
