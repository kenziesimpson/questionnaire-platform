# @qp/admin

The admin SPA (React + Vite): the questionnaire list, draft editor, question bank, version history
and preview. See [`docs/10-frontend.md`](../../docs/10-frontend.md) §5–§6 for the screens and how
authoring concurrency surfaces in the UI.

> **Status:** Track 6 is built. All five screens, the question editor dialog and the publish checks are
> in, wired to each other so the whole authoring flow runs without typing a URL.

## Screens and how they connect

| Route, under `/admin` | Screen | Ways in | Ways on |
| --- | --- | --- | --- |
| `/questionnaires` | Questionnaire list | Main navigation; `/` redirects here | New questionnaire opens its draft; Open draft opens the draft, or the next one; History |
| `/questionnaires/:id/draft` | Draft editor | Create, Open draft, the history's draft row and Open the next draft | Publish lands on version history; Version history once published; back to the list |
| `/questionnaires/:id/versions` | Version history | The list's History, Publish | Preview per version; Edit the open draft, or Open the next draft; back to the list |
| `/questionnaires/:id/versions/:v` | Preview | History, the bank's usage links | Back to version history |
| `/questions` | Question bank | Main navigation | Each usage link opens that version's preview |

Questionnaires is the current navigation item on every questionnaire route, nested ones included. Every
route sets the document title, `<page> · Questionnaire admin`. An unknown path, a questionnaire id that
is not a UUID and a version that is not a positive integer all render the not-found screen, without a
request, and a well-formed id the API does not know gets its screen's own not-found notice, with a way
back.

Opening a draft always goes through `useOpenDraft`: it opens the next draft when none is open, and on
`409 questionnaire/draft-exists` it fetches the draft another tab opened and navigates there, with no
error ([`docs/10-frontend.md`](../../docs/10-frontend.md) §5.2, Decisions Log #67).

## Layout

| Path | Holds |
| --- | --- |
| `src/router.tsx` | Every route, under the `/admin` basepath, with its document title and param parsing |
| `src/page-title.ts` | `pageTitle(page)`, for the not-found screen, which has no route of its own |
| `src/shell/app-shell.tsx` | Header, main navigation and the document head around the routed screen |
| `src/api/client.ts` | `callDefinition(route, parts)` over `definitionApi`, and `draftApi` for the four routes that carry the draft `ETag` |
| `src/api/problem-error.ts` | `ProblemError` (the shared `Problem` for its slug), `UnexpectedResponseError`, `isProblem` |
| `src/api/query-client.ts` | The `QueryClient`: queries retry server and network failures, never a `4xx` problem |
| `src/api/query-keys.ts`, `src/api/queries.ts` | The query keys, and a `queryOptions` factory for every read |
| `src/api/draft-types.ts` | `VersionedDraft`, `DraftContent` and the draft mutation's public types (`DraftChange`, `DraftRejection`, `PublishOutcome`, `DraftMutation`) |
| `src/api/draft-write-ledger.ts` | The pure ETag-chasing ledger `useDraftMutation` builds on: `etagToSend`, `recordSuccess`, `bumpGeneration`, `SupersededDraftWrite` |
| `src/api/mutations/` | Every mutation hook: `useDraftMutation`, `useOpenDraft`, `useSaveQuestion`, `useArchiveQuestion`, `useSetClosesAt`, `useCreateQuestionnaire`. `useMutation` is importable only here |
| `src/lib/` | Shared admin vocabulary: `dates` (`lastEditedLabel`, `fullTimestamp`, the app's one locale — `toLocaleString` and `Intl.DateTimeFormat` are importable only here), `question` (`RESPONSE_TYPE_LABELS`, `isArchived`, `sortByLatestEdit`), `input-patterns`, `counts`, `generated-id` |
| `src/components/` | Admin-only shared pieces: `icons`, `Pill`, `Panel`, `Notice`, `InfoTip`, `BackToQuestionnaires`, `QuestionnaireNotFound`, `field` (`InputField` and friends), `segmented-control`, `sortable-list` (`useSortableList`, `SortableList`, `SortableRow`, used by the draft items list and the option list), `screen-header`, `query-state` (`LoadingLine`, `RetryNotice`) |
| `src/features/question-editor/` | `QuestionEditorDialog`, the create-and-edit dialog the bank and the draft editor embed, `useQuestionEditor` to host it, and the form state it edits |
| `src/screens/not-found.tsx` | The not-found screen |
| `src/screens/questionnaire-list.tsx`, `questionnaire-list/` | The list, the create dialog, the closing-date dialog, and the status and date labels |
| `src/screens/draft-editor.tsx`, `draft-editor/` | The item list and reorder, the bank picker, the predicate editor, the publish-checks panel, the author-facing `DraftItemCode` catalogue and the refused-write notice |
| `src/screens/question-bank.tsx`, `question-bank/` | The bank, its usage column and the archive confirmation |
| `src/screens/responses-list.tsx`, `responses-list/`, `response-detail.tsx`, `response-detail/` | The sessions list — filters, the Started and Submitted sort headers (`sort-header.tsx`, `sorting.ts`), Previous / Next paging — and the session detail screen, which takes its neighbours from the same list query so it follows the list's sort |
| `src/screens/version-history.tsx` | Published versions newest first, with the open draft above them |
| `src/screens/version-preview.tsx`, `version-preview/` | One snapshot through the `@qp/ui` renderer in `readonly` mode (`preview-body.tsx`), and the sample-answers panel |

Each screen's own subdirectory (`screens/<name>/**`) is private: ESLint rejects an import of it from
anywhere but `screens/<name>.tsx` and that subdirectory's own files.

## The question editor dialog

`QuestionEditorDialog` from `src/features/question-editor/question-editor-dialog.tsx` is the one way to
create a question or save a new version of one ([`docs/10-frontend.md`](../../docs/10-frontend.md) §5.3).
It is controlled: the host owns whether it is open.

```tsx
<QuestionEditorDialog
  open={open}
  onOpenChange={setOpen}
  question={latestVersion}
  onSaved={(saved) => repin(saved)}
/>
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `open` | `boolean` | Whether the dialog is shown. Each opening starts from `question`, or from a blank text question |
| `onOpenChange` | `(open: boolean) => void` | Called with `false` on Cancel, Escape, the close button, an outside click and after a save. Not called while a save is in flight |
| `question` | `QuestionVersion`, optional | Edit mode: the version the author starts from, `Question.latest` on the bank. Pass the latest version, since the Save button reads "Save as version N+1". The response type is locked. Omit it to create |
| `onSaved` | `(saved: QuestionVersion) => void` | The version the save wrote: `latest` of `POST /questions`, or the body of `POST /questions/:id/versions`. The dialog closes itself right after. A host that re-pins, such as the draft editor, does it here |

A save invalidates every `questions` query. Focus returns to whatever held it when the dialog opened.

- **Option ids** are `opt_` plus eight random base-36 characters, drawn again on a clash, never typed and
  never changed. They are random rather than counted because the dialog sees only the latest version, so
  a counter could reissue an id an earlier version used for a removed option. `other` comes only from the
  freeform Other checkbox, which keeps it the last option.
- **Yes / No** is a checkbox above the prompt, shown while Single choice is selected. Checked, the question
  is limited to exactly the options `yes` and `no`, labelled Yes and No with the labels editable, and has no
  add, remove, reorder or Other control; the body carries those two options and never `other`. Unchecked,
  the options and Other choice from before come back, or one blank option. In edit mode the checkbox is
  disabled, like the type: a saved single choice whose options are exactly `yes` and `no` shows it checked,
  and any other single choice shows it unchecked.
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
  `components.json` here is an entry point for the shadcn CLI: `npx shadcn add <name> -c apps/admin`
  writes into `packages/ui/src/primitives/`, the same target `packages/ui`'s own `components.json` uses.
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

## Tests

`_tests/` mirrors `src/`. Screen tests render the whole app through `renderAppAt` with a memory
history and a stubbed `fetch`, so each one also exercises the route, the shell and the query client.

- `@qp/ui/testing` supplies the fake `fetch` (`stubFetch`, `FakeServer`, `jsonResponse`,
  `problemResponse`), the axe runner and the jsdom polyfills. `_tests/setup.ts` installs the polyfills
  once, for dialogs and dnd-kit.
- `_tests/support/` holds what more than one directory shares:
  - `builders.ts`: ids, drafts and question versions;
  - `routes.ts`: every definition URL a test stubs, built from the shared route table;
  - `render-app.tsx`: `renderAppAt` and a retry-free `testQueryClient`;
  - `http.ts`: `draftResponse`, `routed`, and an in-memory definition API. The API covers
    questionnaires, drafts with real `ETag` checks, validation through `@qp/shared`'s `validateDraft`,
    publish, versions, questions and usage, and checks every body it accepts or returns against the
    route's schema. `_tests/authoring-flow.test.tsx` drives the full flow across every screen against it.
- `_tests/screens/draft-editor/harness.tsx` and `_tests/features/question-editor/harness.tsx` render
  one screen or feature each and serve only its own tests; ESLint rejects importing another
  directory's harness.
- Each screen has an axe check in its populated, empty and error states through `axeViolations`, with
  `color-contrast` off because jsdom cannot compute it.
