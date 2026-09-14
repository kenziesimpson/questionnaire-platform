# Wave 3 UI prototypes

Static mockups for both applications, drawn before Track 6 and Track 7 start so the five
[[4-implementation-plan#Stop and ask]] gaps are settled by something visible rather than invented
per-agent. The canvas is at
<https://claude.ai/code/artifact/039614ab-b87b-4b4d-a20b-c2a79af57d2a>.

Each `*.dc.html` is one artboard; `canvas.json` lays them out on three pages and is the manifest the
canvas reads. `questionnaire-platform-wave3-ui.html` is the published bundle and is **not committed** —
it is regenerated from these sources by the `design` skill's `seed-canvas.mjs`.

They are mockups, not code: real markup and exact tokens lifted from `packages/ui`, but no React, no
state, no imports. Treat them as the picture the implementation should land on, not as components to
copy wholesale.

## Artboards

| Page | Artboard | Shows |
| --- | --- | --- |
| Respondent | `RespondentStart` | Landing on a resumed session — storage-first resume, the restore strip |
| Respondent | `Main` | The graded branching demo: *Yes* reveals two questions in place, with the `aria-live` text |
| Respondent | `RespondentErrors` | A `422` rejected submit: reachable summary, per-item messages from the code catalogue |
| Respondent | `RespondentDone` | The receipt — session, version, submitted-at, and nothing derived |
| Respondent | `RespondentClosed` | `409 questionnaire/closed` |
| Respondent | `RespondentMobile` | 390px, the touch scale |
| Admin | `AdminList` | Questionnaire list with the sort and filter controls |
| Admin | `AdminDraftEditor` | Item list, predicate editor, publish-checks rail with two failing items |
| Admin | `AdminDraftConflict` | `409 questionnaire/draft-stale` and the rolled-back optimistic reorder |
| Admin | `AdminBank` | Question bank, usage per question, archived rows |
| Admin | `AdminQuestionEditor` | The save-is-publish dialog, locked option ids, re-pinning |
| Admin | `AdminHistory` | Version history, and the absence of response counts |
| Admin | `AdminPreview` | The shared renderer read-only, driven by sample answers, with "hidden by rules" |
| Controls | `ControlSheet` | One control per response type, the Yes/No template, freeform *Other*, four states |
| Controls | `QuestionFields` | The editor's constraint fields per type and the cross-field rules it makes unrepresentable |
| Controls | `ErrorMapping` | `problem+json` → `errorsByItemId` → the sentence under a question, for both apps |

## Decisions these propose

Answers to the five blockers, plus what they turned up:

1. **List sort and filter** — one filter box, a status segment, one sort menu; column headers are not
   sort affordances, so the order on screen is never ambiguous. Default matches the server's `id DESC`.
2. **A control per response type** — on `ControlSheet`. Number is a text input with `inputMode`
   and the unit shown beside it, never `type="number"`; date stays native.
3. **Publish-validation surface** — a rail fed by `POST /draft/validate`, keyed to item numbers, with
   the offending rows marked in the list. Publish cannot disagree with it.
4. **`errorsByItemId`** — on `ErrorMapping`, the same shape for both apps.
5. **Question editor constraint fields** — on `QuestionFields`.

Three things the drawing turned up that the docs do not cover:

- **The ten `DraftItemCode`s have no message catalogue.** `questionnaire/messages.ts` covers submission
  codes only; the admin app needs its own, written for an author.
- **Response type should lock after the first save.** A condition is typed to the question it reads, so
  changing a published question's type invalidates rules in questionnaires the author cannot see.
- **Respondent scale diverges from the primitives.** 52px option rows and 44px inputs against the
  shared 32px controls, which stay as they are in admin.

Preview also needs a decision: the artboard keeps the renderer in `readonly` mode and puts the sample
answers in an admin-owned side panel, so `packages/ui` still owns no form state and an author can still
walk both branches.

## Editing

Edit the `.dc.html` files here, re-seed, and republish to the same URL — never hand-edit the published
bundle.
