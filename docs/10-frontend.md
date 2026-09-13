# Frontend — Detailed Design

> Companion to [[2-design-doc#10. Frontend]], which carries the condensed version. Covers the two applications, the shared renderer, the respondent and admin experiences, authoring concurrency as it surfaces in the UI, accessibility, and the library choices with their reasoning.

## 1. What the frontend has to do

Two audiences with opposite profiles, and one thing genuinely in common.

The **respondent app** is anonymous, potentially high volume, and consists of a single flow: receive a published definition, render the items that apply, collect answers, submit once. It is the surface that would sit behind a CDN, and the one where a vulnerability would be reached ([[7-application-boundary#8. Deployment topology]]), so it stays small and dependency-light on purpose.

The **admin app** is the opposite: low volume, eventually authenticated, and five screens of genuine editing — a question bank, a draft editor with ordering and branching, publishing, version history. Complexity here is expected and affordable.

What they share is **rendering a questionnaire**. The respondent renders it to answer it; the admin renders it to preview a published version. That shared surface is the reason `packages/ui` exists and is the only thing that crosses between them.

## 2. Topology — two apps, one container

### 2.1 Package layout

```
apps/
  backend/          Fastify: definition + execution plugins
  respondent/       Vite SPA — no router, TanStack Form, plain fetch
  admin/            Vite SPA — TanStack Router + TanStack Query, shadcn
packages/
  shared/           Wire types + the rule engine (backend, both apps)
  ui/
    primitives/     shadcn/Radix components, used by both apps
    questionnaire/  The renderer — respondent form and admin preview
```

Two applications rather than one app with two entry points. The eventual split into separately deployed frontends ([[3-scaling#6. Future improvement: split the frontends]]) is then a deployment change and nothing else, and the boundary between them is **package resolution**: `apps/respondent` does not depend on `apps/admin`, so importing across is not a lint rule that can be misconfigured but an unresolvable module. This is stronger than the ESLint zone rule the backend needs, and it is stronger only because the backend's two halves genuinely live in one package while these do not.

Note the asymmetry that follows in §8: the respondent app and the admin app do **not** use the same libraries. That is deliberate rather than accidental, and the rule is stated there.

### 2.2 URL structure and the nginx front

Both apps build into one tree — respondent at the root, admin under `/admin/` — and one nginx container serves both, reverse-proxying `/api` to the backend as before ([[2-design-doc#13. Deployment]]).

| Path | Serves |
| --- | --- |
| `/api/*` | Proxied to `backend` |
| `/admin/*` | Admin SPA, fallback `/admin/index.html` |
| `/*` | Respondent SPA, fallback `/index.html` |

Two details that are cheap up front and annoying to discover later. The admin app needs `base: '/admin/'` in its Vite config or its asset URLs resolve against the root and the page loads blank. And the nginx config uses a single `root` with two `location` blocks rather than `alias` — `alias` combined with `try_files` is a long-standing footgun that silently resolves to the wrong path.

Single origin is preserved, so the trace-context propagation in [[6-observability#6. Client-side telemetry]] still needs no CORS allowances, and neither app needs a build-time API URL.

### 2.3 The dev loop

`docker-compose.override.yml` runs **two** Vite dev servers rather than one. In development the apps are reached on separate ports and each proxies `/api` itself; in production they are same-origin behind nginx. That divergence is worth naming because it is the kind of thing that hides a routing bug until deployment — which is exactly why the end-to-end suite runs against the production compose file ([[8-testing#2.4 End-to-end — Playwright against the composed stack]]) and never against the dev servers.

## 3. `packages/ui` — primitives and the renderer

The package holds two folders and one rule.

`primitives/` is the shared component set — shadcn components over Radix, styled with Tailwind. Both applications import from it directly, so a button in the admin portal and a button in the respondent form are the same button.

`questionnaire/` is the renderer: given a published definition and a set of answers, render the items that are visible. It is built from `primitives/` rather than from raw elements.

**The rule: `packages/ui` owns no fetching, no routing, and no form state.** The renderer is controlled from outside:

```tsx
<QuestionnaireForm
  definition={publishedDefinition}   // the immutable snapshot
  answers={answers}                  // current answer map
  errors={errorsByItemId}            // validation results, no values echoed
  onChange={(itemId, answer) => void}
  mode="interactive" | "readonly"
/>
```

Three things follow from that signature. Admin preview passes static answers in `readonly` mode and needs no form library at all. The respondent app's choice of form state stays local to the respondent app and is reversible without touching the shared package. And component tests need no providers, no router and no query client — they render the thing with props and assert on roles and labels.

Visibility is computed inside the renderer by calling the shared rule engine, not passed in. That keeps the one evaluator ([[2-design-doc#7. Branching Rules]]) as the single source of truth for what is on screen.

## 4. Respondent app

### 4.1 Rendering model — one page, dynamic visibility

**All currently visible items render on a single page.** Answering a question re-evaluates every predicate and the set of visible items changes in place: answering *yes* to the medical-condition question makes the condition and diagnosis-date items appear between the question above and the one below; answering *no* removes them and the page converges again.

The alternative considered was a wizard — one item per screen, driven by the engine's "first unanswered item whose predicate is true". Three things decided it the other way:

- **Pruning is visible.** Submit rejects any answer to an item that is not on the recomputed path ([[7-application-boundary#5.4 Submit: authority, validation, idempotency]]), so answers to closed branches must not be submitted. On one page the respondent watches those questions disappear; in a wizard the same thing happens two screens behind them, silently.
- **Branching is legible.** The graded behaviour is visible as a behaviour rather than inferable from a sequence of screens.
- **Less state.** No cursor to persist, no review step to design, no back-navigation semantics — the page is the review.

What it costs, stated plainly: the brief's "dynamically determines the next applicable question" is satisfied by *filtering* the item list rather than by *navigating* it, and a single page scales badly past a questionnaire of demo size. Both are acceptable now and both are reasons this could change; the renderer's props do not encode the choice, so a wizard would be a change inside `questionnaire/` rather than a change to the boundary.

### 4.2 Entry and resume

The respondent app has one URL, `/q/:questionnaireId`, and everything after it is a state machine rather than a route: *starting → form → submitted*, with *closed* and *not-found* as terminal states. None of those are worth deep-linking, which is why the app ships no router (§8).

**On landing:**

1. Look in local storage for a session belonging to this questionnaire.
2. If one exists, `GET /sessions/:sessionId`. A live `in_progress` session resumes with its answers; an already-`submitted` session renders the receipt; a `404` means the id is stale, so clear it and continue to step 3.
3. Otherwise `POST /sessions`, which pins the current published version and returns the definition in the same response.
4. A `409 questionnaire/closed` at either step renders the "responses closed" page.

This sequencing — check storage, then resume, then create — is what keeps resume possible at all; creating a session unconditionally would orphan any in-progress one ([[7-application-boundary#5.2 There is no unpinned definition read]]).

There is **no `/s/:sessionId` resume link** in the prototype. With the checkpoint endpoint deferred ([[2-design-doc#17. Decisions Log]] #25) answers live only in the browser that produced them, so such a link would open a valid session with no answers in it and invite the respondent to start over without saying so. The capability-URL language in [[7-application-boundary#7. Access model and data barriers]] remains the access *model* for when identity arrives; it is simply not exercised by a route today.

### 4.3 Local persistence

`localStorage`, keyed by questionnaire id, holding `{ sessionId, questionnaireId, answers, updatedAt }`.

**Answers to hidden items are kept, not pruned.** The alternative — deleting an answer the moment its branch closes — has to hold the invariant "storage contains only visible answers" across every mutation, and any path that misses it submits a stale answer and earns a `422`. Filtering once, at submit, is a single chokepoint instead of N, and it uses the same `visibleItems` call the server runs. Keeping them also means toggling *no → yes* restores what was typed rather than silently discarding it.

The definition is **not** cached locally. `GET /sessions/:sessionId` returns the pinned definition on resume, so a second copy would only be an opportunity for the two to disagree.

Local state is cleared on a successful submit.

The tradeoffs of browser-held answers — no cross-device resume, incognito loses progress, Safari evicts storage for sites unvisited for roughly seven days — are listed in [[3-scaling#7. Known tradeoffs of browser-held partial answers]] and are accepted rather than mitigated.

### 4.4 Submit

The client computes the visible set with the shared engine, sends only those answers, and lets the server be the authority anyway. Sending a filtered payload is not a trust boundary; it is how the client avoids submitting something it already knows will be rejected.

The same is true of the relative date constraints (`not_future`, `not_past`). The respondent app runs the shared evaluator from `@qp/shared` client-side, parameterized with the **browser's local date**, so a control rejects a genuinely-future date before submit; the server independently re-runs the identical evaluator parameterized with **UTC today and one day of tolerance** ([[5-questionnaire-format#2.4 Relative date constraints resolve against two different clocks]]). The two are allowed to disagree by up to a day at the edges — that slack is deliberate (Decisions Log #38), not a discrepancy for the client to reconcile.

A `422` names item ids and rule codes and never carries values ([[7-application-boundary#5.5 Error bodies must not echo answers]]), so the client renders the message against the answer it already holds. Errors map onto items by `itemId` and are handed to the renderer through the `errors` prop.

## 5. Admin app

### 5.1 Screens

| Screen | Purpose |
| --- | --- |
| Questionnaire list | Status, current version, `closesAt`; create, open, retire |
| Draft editor | Item list — add from the bank, reorder, `required`, `visibleWhen`, publish |
| Question bank | List, create, edit, archive; usage per question |
| Version history | Published versions for one questionnaire, each openable |
| Preview | One snapshot rendered through `questionnaire/` in `readonly` mode |

The bank keeps its own screen rather than collapsing into the draft editor's picker, because reusable questions are a graded capability and a screen showing one question used by three questionnaires demonstrates reuse in a way a picker does not. `GET /questions/:questionId/usage` exists for exactly that column.

Questions can also be **created and edited from inside the draft editor**, without navigating away. A question created there is an ordinary bank question — the model has no notion of a questionnaire-private question — and appears on the bank screen like any other.

### 5.2 The draft editor

The draft is written back with `PUT /questionnaires/:id/draft`, which replaces the whole document ([[7-application-boundary#4.1 Endpoints]]). Concurrency is the `If-Match` ETag over the draft: hold the ETag from the GET, send it with every mutation, and on `409 questionnaire/draft-stale` invalidate the draft query and tell the author that someone else changed it. That is the client half of a decision already made on the server, and it is the reason the admin app has a query cache at all.

Reordering uses dnd-kit, and each drop is a draft mutation — optimistic through TanStack Query, rolled back if the write conflicts.

**Validation runs while editing, not at publish.** `POST /questionnaires/:id/draft/validate` is a dry run of the publish checks using the identical code path, so an unsatisfiable predicate or a forward reference surfaces as the author creates it. Publish then refuses on the same result, which means the editor cannot show a green state that publish disagrees with.

### 5.3 The question editor, and re-pinning

The editor is a dialog. Questions are append-only and **saving is publishing** ([[5-questionnaire-format#6.2 Question identity and versioning]]), so the dialog holds working state client-side and writes exactly one new version when the author commits — one deliberate save, one version.

Creating a question starts with choosing one of the five response types, which drives the constraint fields the rest of the dialog shows (§8, §9.4). A **Yes / No** template button shortcuts that choice: it creates a `single_choice` question pre-populated with two options — reserved ids `yes` / `no`, labels "Yes" and "No" — with those labels left editable, so the same question can read True / False or Agree / Disagree without becoming a different kind of thing. This is the editor's answer to the brief's "yes or no" response type now that `yes_no` is not a stored type ([[5-questionnaire-format#2. Question types]], Decisions Log #36).

That collides with pinning. Items pin a question version at add time and keep it, so an author who edits a question from inside the draft editor would create version *N+1* while the item stayed on *N*, and the edit would appear to do nothing.

**Editing a question from within the draft editor re-pins that item to the new version.** The gesture is unambiguous — the author is editing this question in the context of this draft — and other questionnaires' items are untouched, because each pins its own version. This is the deferred "upgrade to latest" capability ([[2-design-doc#19. Future Work]]) scoped to one item and triggered by an edit, rather than offered as a general review action.

The other path to a stale pin remains: editing the same question from the bank screen leaves any draft using it behind. The item list shows a **read-only staleness marker** when an item's pinned version is not the latest. Acting on it is still remove-and-re-add; building the general upgrade action stays out of scope.

### 5.4 The predicate editor

A flat list of condition rows over one `all` / `any` selector. No nesting, no tree, no drag-and-drop between groups — because the model is a single level of `all` / `any` over conditions typed per response type ([[5-questionnaire-format#4. Branching rules]]), and the honest UI for that model is a list of rows.

Each row is three controls: **which earlier question**, **which operator**, **what value**. Two of them are constrained by data rather than by validation:

- the question picker offers **only items at a lower index**, so a forward reference is unrepresentable in the UI rather than rejected at publish;
- the operator list is derived from the referenced question's response type, so comparing a date against a number cannot be expressed.

That is the same move the format model makes, one layer up: the invalid states are removed from the interface instead of detected in it. It is also why this screen is cheap despite sounding expensive — the format decision paid for it in advance.

## 6. Authoring concurrency

Three races exist between two authors. The brief asks for concurrency control to be defensible, and two of these are resolved by contract shape rather than by locking.

**A edits a question while B adds it to a draft.** The add-item request carries the `questionVersion` the client displayed, never resolving "current" server-side. B pins the version B actually read, and "items pin at add time" becomes literally true rather than approximately. This is the authoring echo of the execution side's no-unpinned-read rule ([[7-application-boundary#5.2 There is no unpinned definition read]]).

**Two authors edit the same question concurrently.** Accepted and documented, not guarded. Append-only means A's save creates *N+1* and B's creates *N+2*; nothing is overwritten and no version is lost, but B authored against *N* and so *N+2* does not carry A's change.

The reason this is safe to accept is the blast radius rather than the frequency. Because pinning is always explicit and nothing auto-upgrades to latest, a lost authoring edit **cannot reach a published snapshot and cannot change what any collected response means**. It stays a collision between two authors over bank content, and both versions remain in the history to reconcile from. An `If-Match` on question saves would close it for the same cost as the draft ETag; it is declined because append-only already prevents the failure that matters, and the remaining exposure is one an author can see and fix. A question **version picker** in the draft editor ([[2-design-doc#19. Future Work]]) is the change that would make the divergence visible at the point it matters.

**A archives a question while B's picker is stale.** Rejected at add time. Harmless to the data — snapshots hold question content forever — but adding a question that was just retired from the bank contradicts what archiving means.

A fourth case is already covered elsewhere: re-pinning an item while that draft is being published is caught by the item guard's locking read ([[9-database-schema#4.1 The item guard, and the two ways it fails naively]]).

## 7. Accessibility

The demo questionnaire collects medical conditions. Accessibility is treated the same way answer redaction is — designed in at the point the decision is made, rather than audited afterwards.

**What the libraries actually provide.** Radix primitives carry the parts that are hard to hand-roll and easy to get subtly wrong: dialog focus trapping and restoration for the question editor, roving focus in radio groups, correct `aria-*` wiring on the controls. dnd-kit provides a keyboard sensor and screen-reader announcements for sortable lists, which is what makes drag-based reordering usable at all without a pointer. TanStack Form provides none of this — it is headless and renders nothing; what it contributes is reliable per-field error and touched state to attach `aria-invalid` and `aria-describedby` to, and knowledge of the first invalid field so focus can move there on a failed submit.

**What we write ourselves.**

- A `<fieldset>` with a `<legend>` per choice group; a real `<label>` per control; `aria-invalid` and `aria-describedby` pointing at the error node.
- **An `aria-live="polite"` region announcing visibility changes.** This is the gap the single-page model creates: answering *yes* makes two questions appear, and without an announcement a screen-reader user is told nothing at all. Announce what was added or removed.
- Focus moved to the first invalid item on a rejected submit, and the error summary reachable rather than merely visible.
- Native `<input type="date">` rather than a custom date widget — accessible, free, and internationalised by the platform.

**What is tested.** [[8-testing#2.4 End-to-end — Playwright against the composed stack]] already queries by role and label, which makes the labelling a tested property. Added to that: an `@axe-core/playwright` check on the respondent form and the draft editor. This narrows the deferral in [[8-testing#9. Open questions]] §4 from "not graded, so deferred" to a committed minimum, on the grounds that the domain argues for it even where the rubric does not.

**What is not done.** A full WCAG 2.2 AA audit, a real screen-reader matrix (NVDA/JAWS/VoiceOver), and reduced-motion and high-contrast handling. Named so the commitment above is not mistaken for a claim of conformance.

## 8. Library choices

The through-line: **the respondent app stays dependency-light and imperative; the admin app takes tooling where it has genuine cached server state or conventional editing.** Where they differ, they differ for that reason.

| Concern | Respondent | Admin |
| --- | --- | --- |
| Routing | None | TanStack Router, code-based |
| Server state | Plain `fetch` | TanStack Query |
| Form state | TanStack Form | Hand-rolled controlled state |
| Drag and drop | — | dnd-kit |
| Components | `packages/ui/primitives` (shadcn + Radix) | Same, plus admin-only shadcn components |
| Styling | Tailwind v4 | Tailwind v4 |

**Routing.** The respondent app has one URL and a state machine behind it; a router would be a dependency bought to read one path parameter. The admin app has nested screens and genuinely linkable resources — "here is v2 of the intake form" is a URL worth pasting. TanStack Router over React Router v7 for typed params and ecosystem fit; **code-based rather than file-based**, because file-based needs the Vite plugin plus a generated `routeTree.gen.ts` committed and kept in sync, which earns little across five screens and reads worse in review.

**Server state.** Three uncached calls on one side; roughly eight endpoints with cross-invalidating mutations on the other, where publishing changes the questionnaire list, the version history and the draft state at once. TanStack Query is the tool for the second and dead weight on the first.

**Form state.** TanStack Form in the respondent app, for ecosystem consistency and for the per-field error and touched bookkeeping the accessibility work depends on. Not in the admin app: the two admin forms that matter are dynamic in a way that fights schema-first form state — the question editor's constraint fields depend on the selected response type, and a condition row's operators depend on the referenced question's type — so a form library would spend its budget on conditional field registration. Controlled state and validation from `@qp/shared` is less machinery there, not more.

This asymmetry is the one thing in this document a reviewer is most likely to query, so to state it directly: the library goes where the validation state is complex and runtime-driven, and nowhere else.

**Drag and drop.** dnd-kit, for the keyboard sensor and announcement API (§7). `react-beautiful-dnd` is deprecated and `@atlaskit/pragmatic-drag-and-drop` — its successor and the better core — leaves keyboard support to be assembled.

**Components and styling.** Tailwind v4 with shadcn/Radix primitives in `packages/ui`, used by both apps. Utility classes rather than a bespoke CSS architecture partly because the build is parallelised across agents, and a shared vocabulary drifts far less than independently invented class naming. One setup detail that bites: Tailwind must be configured to scan `packages/ui` from each app, or shared-component classes are purged from the build and the renderer arrives unstyled with no error.

## 9. Alternatives considered

### 9.1 A wizard — one item per screen

Covered in §4.1. It is the more literal reading of "dynamically determines the next applicable question," and it makes the engine's `nextItem` the actual navigation rather than a filter. Rejected because it hides answer pruning off-screen, needs a review step and a cursor, and makes the branching behaviour something a reviewer infers from a sequence rather than watches happen.

### 9.2 One Vite app with two entry points

Vite builds multi-page apps natively, and `src/respondent/` plus `src/admin/` behind two HTML entries would give separate bundles with one build, one container and one dev server — the exact frontend analogue of the backend's "two plugins in one process". Rejected on the user's call for two apps; the cost paid is a second build and a second dev server, and the thing bought is that the boundary is package resolution rather than an ESLint zone rule.

### 9.3 React Router v7

The safe pick, and the one more reviewers will recognise. Passed over for TanStack Router on typed params and consistency with TanStack Query, with familiarity judged the weaker consideration for a five-screen admin app.

### 9.4 A form library in the admin app

`useFieldArray` is genuinely pleasant for the question editor's options list, which is the one place a form library would earn something on that side. Judged not enough to pay for it against forms whose shape is decided at runtime.

### 9.5 React Aria instead of Radix

Adobe's React Aria — and the higher-level React Aria Components — go deeper than Radix on screen-reader behaviour across platforms, on touch interaction, and on internationalisation. Chosen against for now because the gap is small across our control set, and because the strongest single argument for it, its internationalised date field, is moot while we use native `<input type="date">`.

**How it would be adopted later, if it earns it.** The migration is contained by the structure already in place: `packages/ui/primitives/` is the only place Radix is imported, and both apps plus the renderer consume primitives rather than Radix directly. So a swap is a change inside that folder, one primitive at a time, with each keeping its props contract and changing its implementation. Two things would trigger it. **Localisation** ([[2-design-doc#19. Future Work]]) brings locale-specific snapshots and with them date, number and unit input that has to be right in every locale — that is React Aria's strongest ground and the point at which native inputs stop being sufficient. **A real screen-reader matrix**, if accessibility conformance ever becomes a requirement rather than a principle, since React Aria carries substantially more platform-specific behaviour than Radix. Neither is worth pre-paying, and the primitives boundary is what keeps the option open at roughly the cost of the components actually swapped.

### 9.6 No shared component library — Radix directly in the renderer

Considered to keep the respondent bundle minimal. The marginal cost of shadcn over Radix-direct turns out to be `cva`, `clsx` and `tailwind-merge`, on the order of 3–4 kB gzipped, against a real consistency benefit across two apps built in parallel. Rejected: the leanness argument was not worth what it cost.

## 10. Open questions

1. **Single-page rendering past demo size.** The model is fine for a handful of items and degrades for a long questionnaire. Pages and sections are already deferred ([[2-design-doc#18. Open Questions]] §5); if they arrive, the rendering model is the thing they change.
2. **Admin authentication shape.** The access model is written ([[7-application-boundary#7. Access model and data barriers]]) but the client side of it — where a token lives, how a 401 is handled, whether the admin app is served at all to an unauthenticated caller — is undesigned because auth is out of scope.
3. **Error and empty states.** Named here so they are built rather than discovered: network failure during submit, a definition that fails to load, an empty question bank, a questionnaire with no published version.
4. **Optimistic update scope in the draft editor.** Reordering is optimistic; whether predicate and `required` edits should be is unsettled, and it interacts with how visible the `409` path is.
