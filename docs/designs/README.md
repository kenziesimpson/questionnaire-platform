# Wave 3 UI prototypes

Static mockups for both applications, drawn before Track 6 and Track 7 start so the Wave 3 screens
are settled by something visible rather than invented per-agent. The canvas is at
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
| Respondent | `RespondentStart` | Landing on a resumed session — storage-first resume, the restore strip. Its *Start over* button is punted ([gh#35](https://github.com/kenziesimpson/questionnaire-platform/issues/35), #74) |
| Respondent | `Main` | The graded branching demo: *Yes* reveals two questions in place, with the `aria-live` text |
| Respondent | `RespondentErrors` | A `422` rejected submit: reachable summary, per-item messages from the code catalogue |
| Respondent | `RespondentDone` | The receipt — session, version, submitted-at, and nothing derived |
| Respondent | `RespondentClosed` | `409 questionnaire/closed` |
| Respondent | `RespondentMobile` | 390px, the touch scale |
| Admin | `AdminList` | Questionnaire list, sorted most recently edited — the one client-side sort #53 ships |
| Admin | `AdminDraftEditor` | Item list, predicate editor, publish-checks rail with two failing items |
| Admin | `AdminDraftConflict` | `409 questionnaire/draft-stale` and the rolled-back optimistic reorder |
| Admin | `AdminBank` | Question bank, usage per question, archived rows |
| Admin | `AdminQuestionEditor` | The save-is-publish dialog, locked option ids, re-pinning |
| Admin | `AdminHistory` | Version history, and the absence of response counts |
| Admin | `AdminPreview` | The shared renderer read-only, driven by sample answers, with "hidden by rules" |
| Controls | `ControlSheet` | One control per response type, the Yes/No template, freeform *Other*, four states |
| Controls | `QuestionFields` | The editor's constraint fields per type and the cross-field rules it makes unrepresentable |
| Controls | `ErrorMapping` | `problem+json` → `errorsByItemId` → the sentence under a question, for both apps |

## What these settle

Decisions Log #53–#55 landed while these were being drawn, and #58 then adopted the artboards for the
two items still open, so every Wave 3 Stop-and-ask item is answered. The artboards are now
**illustrations of a decision, not a proposal** — where one disagreed with what landed, the artboard was
changed, not the decision:

| Landed | Drawn as |
| --- | --- |
| #53 — one client-side sort, most recently edited; no search, filters or sortable columns (gh#21) | `AdminList`, `AdminBank` |
| #54 — validation as a summary panel with jump-to-item links; inline per-item rendering deferred (gh#22) | `AdminDraftEditor` |
| #55 — one `errorsByItemId` in `packages/ui` for both apps, dropping the two non-item codes (gh#23) | `ErrorMapping` |
| Response-type controls, settled in [[10-frontend#3. `packages/ui` — primitives and the renderer]] | `ControlSheet` |
| #58 — the question editor's constraint fields per type, with the six cross-field rules unrepresentable in the controls rather than reported after a save | `QuestionFields` |
| #58 — the options-authoring widget: drag to reorder, generated option ids shown and locked, freeform marked on its row; the Yes / No template is required | `AdminQuestionEditor` |

Both were the open items in [[2-design-doc#20. Pending UI experimentation]], which is now empty.

## What drawing them turned up

- **`QuestionnaireSummary` has no `updatedAt`.** #53 sorts both lists on "most recently edited" and the
  wire type carries only `createdAt`. Either the field is added or the decision means something else.
  *Resolved by #59:* the field is added, from the latest version's `updated_at`; the bank sorts on
  `latest.createdAt`.
- **The ten `DraftItemCode`s have no message catalogue.** `questionnaire/messages.ts` covers submission
  codes only; #54's summary panel needs one written for an author, not a respondent. *Resolved by #60:*
  a typed catalogue in `apps/admin`, with a design pass during Track 6.
- **Response type should lock after a question's first save.** A condition is typed to the question it
  reads, so changing a published question's type invalidates rules in questionnaires the author cannot
  see from the dialog. *Resolved by #61:* locked in the editor and refused by the server with
  `question/type-changed`.
- **The respondent scale diverges from the primitives** — 52px option rows and 44px inputs against the
  shared 32px controls, which stay as they are in admin. *Deferred by #63:* the respondent app uses the
  primitives' sizes for Wave 3; these artboards are first approaches, not pixel specs.
- **Preview needs the renderer to stay `readonly`.** `AdminPreview` puts the sample answers in an
  admin-owned side panel, so `packages/ui` still owns no form state and an author can still walk both
  branches.

## Editing

Edit the `.dc.html` files here, re-seed, and republish to the same URL — never hand-edit the published
bundle.
