# @qp/ui

The one package both frontends share ([`docs/10-frontend.md`](../../docs/10-frontend.md) §3): the
shadcn/Radix component primitives, the Tailwind theme, and the questionnaire renderer used by the
respondent form and the admin preview.

> **Status:** the renderer is complete for all five response types. The respondent and admin apps
> that drive it are Wave 3.

## Conventions

- **No fetching, no routing, no form state.** The renderer is controlled entirely by props:
  `definition`, `answers`, `errors`, `onChange(itemId, answer)` and `mode`. Callers own the answers
  and pass them back in, so admin preview needs no form library and component tests need no
  providers.
- Visibility is computed by calling `visibleItems` from `@qp/shared`, never reimplemented here.
- Error messages come from one catalogue (`src/questionnaire/messages.ts`) keyed by
  `SubmissionItemCode`, used for both client-side and server errors. Messages are built from the
  question alone, never from an answer.
- Radix is imported only inside `src/primitives/`. The renderer and both apps use primitives, which
  keeps a later swap to another component library to that one folder (`docs/10-frontend.md` §9.5).
- The package ships TypeScript source through its `exports` map and has no build step; each app
  compiles it with its own Vite pipeline.

## Layout

| Path | Contents |
| --- | --- |
| `src/primitives/` | shadcn components written by the CLI (`button`, `input`, `label`, `radio-group`, `checkbox`, `textarea`, `dialog`, `select`, `popover`, `table`, `command`, and `input-group`, which `command` needs). A searchable combobox is shadcn's `Popover` + `Command` pattern, composed where it is used; shadcn's own `combobox` is built on Base UI rather than Radix, so it is not added |
| `src/questionnaire/` | `QuestionnaireForm`, `QuestionnaireItems`, one control per response type, the `aria-live` visibility announcer, the error catalogue, and `errorsByItemId`, which groups a `submission/invalid` body into the `errors` prop |
| `src/styles/globals.css` | Tailwind v4 entry, shadcn theme tokens, and the `@source` that scans this package |
| `src/lib/utils.ts` | The `cn` helper the shadcn `utils` alias points at |
| `components.json` | shadcn configuration for components written into this package |

Import paths are `@qp/ui/primitives/<name>`, `@qp/ui/questionnaire`, `@qp/ui/lib/utils` and
`@qp/ui/globals.css`.

## Tailwind and shadcn in a package

`shadcn init` cannot run here because it finds no framework in a package, so the setup follows the
layout the CLI generates for its own monorepo template:

- `packages/ui/components.json` points the `ui`, `components` and `utils` aliases at `@qp/ui/*`, and
  `tsconfig.json` maps `@qp/ui/*` to `./src/*` so the CLI can resolve them to folders.
- `apps/admin/components.json` points its `ui` and `utils` aliases and its Tailwind CSS path at this
  package, and keeps `@/components` for admin-only components.
- Add a shared component from the repo root with `npx shadcn add <name> -c apps/admin`. The CLI
  writes it into `src/primitives/` here. Check whether it pulls in a dependency (e.g. `checkbox`
  needs `lucide-react`) and add that to this package's `dependencies`.
- Each app imports the theme through its own `src/index.css` (`@import "@qp/ui/globals.css";`) and
  runs `@tailwindcss/vite`. `globals.css` declares `@source "../**/*.{ts,tsx}"` so this package's
  classes are generated in every app's build. Without it they are purged silently and the renderer
  arrives unstyled.
- `shadcn` is a devDependency: the CLI and its `shadcn/tailwind.css` are only used at build time.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run test -w packages/ui` | Component and axe tests (vitest + React Testing Library in jsdom, `_tests/`) |
| `npm run typecheck -w packages/ui` | Typecheck `src/` and `_tests/` (needs `packages/shared` built) |
