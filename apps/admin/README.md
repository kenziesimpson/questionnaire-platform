# @qp/admin

The admin SPA (React + Vite): the questionnaire list, draft editor, question bank, version history
and preview. See [`docs/10-frontend.md`](../../docs/10-frontend.md) §5–§6 for the screens and how
authoring concurrency surfaces in the UI.

> **Status:** Track 6 PR0, the skeleton, plus PR2, the question editor dialog. The shell, the route
> tree with a stub per screen, the API client, the query keys, the optimistic draft-mutation hook and
> `QuestionEditorDialog` are in; the screens are not.

## Layout

| Path | Holds |
| --- | --- |
| `src/router.tsx` | Every route, under the `/admin` basepath. Screen PRs replace their file in `src/screens/`, not this |
| `src/screens/` | One component per screen: `questionnaire-list`, `draft-editor`, `question-bank`, `version-history`, `version-preview` |
| `src/shell/app-shell.tsx` | Header and main navigation around the routed screen |
| `src/api/client.ts` | `callDefinition(route, parts)` over `definitionApi`, and `draftApi` for the four routes that carry the draft `ETag` |
| `src/api/problem-error.ts` | `ProblemError` (the shared `Problem` for its slug), `UnexpectedResponseError`, `isProblem` |
| `src/api/query-keys.ts`, `src/api/queries.ts` | The query keys, and a `queryOptions` factory for every read |
| `src/api/use-draft-mutation.ts` | `useDraftMutation(questionnaireId)`: the only way to write or publish a draft |
| `src/screens/question-editor/` | `QuestionEditorDialog`, the create-and-edit dialog the bank and the draft editor embed |

## The question editor dialog

`QuestionEditorDialog` from `src/screens/question-editor/question-editor-dialog.tsx` is the one way to
create a question or save a new version of one ([`docs/10-frontend.md`](../../docs/10-frontend.md) §5.3).
It is controlled: the host owns whether it is open.

```tsx
<QuestionEditorDialog
  open={open}
  onOpenChange={setOpen}
  question={latestVersion}
  repinsInDraft="Patient Intake"
  onSaved={(saved) => repin(saved)}
/>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `open` | `boolean` | Whether the dialog is shown. Each opening starts from `question`, or from a blank text question |
| `onOpenChange` | `(open: boolean) => void` | Called with `false` on Cancel, Escape, the close button, an outside click and after a save. Not called while a save is in flight |
| `question` | `QuestionVersion`, optional | Edit mode: the version the author starts from, `Question.latest` on the bank. Pass the latest version, since the notice promises version N+1. The response type is locked. Omit it to create |
| `repinsInDraft` | `string`, optional | The draft's title. Adds "and re-pins this question in the … draft" to the save notice; the host does the re-pin in `onSaved` |
| `onSaved` | `(saved: QuestionVersion) => void` | The version the save wrote: `latest` of `POST /questions`, or the body of `POST /questions/:id/versions`. The dialog closes itself right after |

A save invalidates every `questions` query. Focus returns to whatever held it when the dialog opened.

- **Option ids** are `opt_` plus eight random base-36 characters, drawn again on a clash, never typed and
  never changed. They are random rather than counted because the dialog sees only the latest version, so
  a counter could reissue an id an earlier version used for a removed option. `yes` and `no` come only from
  the Yes / No template, and `other` only from the freeform Other checkbox, which keeps it the last option.
- **Cross-field rules** cannot be entered. Moving a lower bound above its upper bound moves the upper bound
  with it; an upper bound typed below its lower bound is clamped when the field loses focus, and again when
  the body is built. Selection bounds are capped by the option count.
- **Errors.** An empty prompt or option label is named before anything is sent. A `400 request/invalid`
  lands on the field its pointer names, `question/type-changed` on the type row; a pointer no field owns,
  and any other failure, shows as an alert above the fields, with the author's changes kept.
- **Reordering** is dnd-kit with the keyboard sensor: Space or Enter picks an option up, the arrow keys move
  it, Space or Enter drops it and Escape cancels without closing the dialog. Moves are announced in a live
  region inside the dialog.

## Conventions

- Built with `base: '/admin/'`. Without it, asset URLs resolve against the root and the page loads
  blank behind nginx. Served at `/admin/` with SPA fallback to `/admin/index.html`
  ([`deploy/frontend/nginx.conf`](../../deploy/frontend/nginx.conf)).
- Shared components and the preview renderer come from [`@qp/ui`](../../packages/ui/README.md).
  `components.json` here is the entry point for the shadcn CLI: `npx shadcn add <name> -c apps/admin`
  writes shared components into `packages/ui/src/primitives/` and admin-only ones into
  `src/components/` (the `@/` alias).
- `/api` is proxied to the backend: by nginx in production, by the Vite dev server in development
  (`VITE_API_PROXY_TARGET`, default `http://localhost:3000`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev -w apps/admin` | Vite dev server on `:5174`, at `/admin/` |
| `npm run build -w apps/admin` | Typecheck and build to `dist/` (needs `packages/shared` built) |
| `npm run preview -w apps/admin` | Serve the built `dist/` locally |
| `npm run typecheck -w apps/admin` | Typecheck `src/`, `_tests/` and the Vite and Vitest configs |
| `npm run test -w apps/admin` | Vitest and React Testing Library in jsdom; `npm test` at the root runs it too |
