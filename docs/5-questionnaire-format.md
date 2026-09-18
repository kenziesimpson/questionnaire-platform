# Questionnaire Format — Detailed Design

> The detailed design for how a questionnaire, its questions and its rules are represented,
> validated and versioned. [[2-design-doc#5. Questionnaire Format]], [[2-design-doc#6. Versioning & Immutability]]
> and [[2-design-doc#7. Branching Rules]] carry the condensed version; this doc is the depth behind them.
> Decisions are recorded in [[2-design-doc#17. Decisions Log]] #6–#12. Anything still undecided is
> tracked in [[2-design-doc#18. Open Questions]], not here.

## 1. The model

A **questionnaire version** is a flat, ordered list of **items**. An item places one question version at an index and carries the questionnaire-specific concerns:

- `required` — whether an answer is needed *when the item is reachable*.
- `visibleWhen` — an optional predicate over earlier answers (§4).

Reusable question content never carries placement or branching. A question is reusable precisely because where it sits, whether it is required there, and what makes it appear are **not** properties of the question.

There are no edges between questions. Order is the list index; the next question is the first unanswered item whose predicate evaluates true. Convergence after a branch is not a property to prove — it is the only thing a list can do. See §6 for the models this was chosen over.

**Identifiers come in two kinds.** Bank rows, questionnaires, sessions and published versions are addressed by uuid (v7 or v4), never a sequential integer. `itemId`, `optionId` and the `key` slugs on questions and questionnaires are different: they are authored identifiers that live inside a document rather than as a database row, matching `^[a-z][a-z0-9_]{0,63}$`. That pattern only constrains shape, not which slugs are meaningful: `yes` and `no` are reserved by editor convention alone (§2), while `other` carries an enforced guarantee, not just a convention (§2.3).

## 2. Question types

Five response types. Constraints belong to the question version and compile into a validator at publish time.

| Type | Constraints | Notes |
| --- | --- | --- |
| `text` | `minLength`, `maxLength`, `multiline` | `multiline` distinguishes short answer from long form. Format subtypes (email, phone, regex) are deferred — [[2-design-doc#18. Open Questions]] §2. |
| `single_choice` | `options` (at least one), optional freeform `other` | Exactly one selection. |
| `multiple_choice` | `options` (at least one), `minSelections`, `maxSelections`, optional freeform `other` | `minSelections` of 1 or more is how "required, pick at least one" is expressed. |
| `number` | `numberKind` (`integer` or `float`, required), `min`, `max`, `unit` | `unit` is a display label; conversion between compatible units is future work. Answers are exact decimal strings, stored in canonical form (trailing fractional zeros and point stripped, `-0` → `0`), so `integer` accepts `72.0` as `72` — [[7-application-boundary#5.4 Submit: authority, validation, idempotency]]. |
| `date` | `min` / `max` (absolute), `relative` (`not_future`, `not_past`) | Relative constraints let "when were you diagnosed?" reject future dates without baking a fixed date into the definition. Whose "today" they resolve against is §2.4. Date *ranges* are out of scope — model as two date questions. |

**Yes / No is not a type.** The brief lists "yes or no" among the practical response types and the platform
supports it — as a `single_choice` question with two options, which is what it is. The editor offers a
**Yes / No** template that creates one with option ids `yes` and `no` and labels "Yes" and "No". The labels
are editable like any others, so the same question can read True / False or Agree / Disagree without
becoming a different kind of thing. A distinct type bought a duplicated operator set, a second branch in the
response shape constraint and a `display` render hint, and cost the author the ability to phrase the
question — see [[2-design-doc#17. Decisions Log]] #36, superseding #10.

The reserved ids `yes` and `no` are an **editor convention, not a guarantee**, unlike `other` (§2.3). A template-created question aggregates
across questionnaires on `yes` / `no`; a two-option question assembled by hand does not. That is the same
tier as option-id stability below — upheld by the editor and proven by a test, not by a constraint, for the
reason [[9-database-schema#3.2 The question bank]] gives when it rejects a registry table.

### 2.1 Option ids are stable across question versions

Rewording an option's label does not change the identity of responses already collected against it. Rules reference option ids, never labels, so a relabelling version bump cannot change what a rule means either.

This is the mechanism that makes the brief's "change one question without changing the meaning of responses already collected" demonstrably true rather than asserted, and it is what the v2 demo should exercise.

### 2.2 Number answers carry their unit

A stored answer is `{ value, unit }`, not a bare number. A later version that switches `cm` to `in` therefore cannot retroactively change what an earlier answer meant. The unit is duplicated from the question version deliberately: a response must be interpretable without joining back to the definition it was collected under.

### 2.3 The `other` option

A choice question may mark a trailing option as freeform. The answer then has two parts — the selected option ids (one being `other`) and an `otherText` string — so the stored shape for every choice question carries an optional `otherText`, validated with the same length rules as a `text` question.

**The id `other` is reserved for the freeform option, in both directions.** A freeform option must have the id `other` (`question/freeform-not-other`), and an option with the id `other` must be freeform (`question/other-not-freeform`). Saving a question that breaks either rule is `400 request/invalid`, and the `freeform_exactly_when_other` check holds the same rule in the database ([[9-database-schema#3.2 The question bank]]). The validator, the renderer and the admin editor all find the option through `freeformOptionOf` in `@qp/shared` ([[2-design-doc#17. Decisions Log]] #82, #83).

**Rules may test whether `other` was selected; they may not match against the text.** Kept deliberately simple: text matching in rules is fragile and there is no version-stable identity to match on. If `otherText` ever needs to drive a branch, the likely shape is a promotion workflow — an admin converts a recurring freeform answer into a real option in the next version — rather than string matching in the rule engine. Noted as a possible future change, not a current limitation to design around.

### 2.4 Relative date constraints resolve against two different clocks

`date_value` is a bare `date` on purpose — a date question collects a calendar date, and attaching a timezone
would invent precision the respondent never supplied ([[9-database-schema#6.1 `response`]]). But `not_future`
means "not after today", and the server and the respondent do not necessarily agree on which day that is.

The failure is not hypothetical and not rare. Containers run UTC. A respondent at UTC+13 on the morning of
the 14th is still on the 13th in UTC, so answering "when were you diagnosed?" with today produces
`2026-09-14 <= 2026-09-13` and a rejection — for roughly thirteen hours of every day, with no answer they can
give that the server will accept. It breaks symmetrically west of UTC, where an evening respondent is already
on tomorrow's UTC date and a `not_past` question rejects their today. The seeded demo carries a `not_future`
diagnosis date, so this sits inside the graded scenario.

**The rule: the client validates for the user, the server validates for the system.**

- The respondent app evaluates the constraint against the **browser's local date**, so the control rejects
  tomorrow correctly and the respondent never encounters the slack below.
- The server evaluates against **UTC today with one day of tolerance** — `not_future` accepts
  `date <= utcToday + 1`, `not_past` accepts `date >= utcToday - 1`. It is not trying to reconstruct the
  respondent's calendar; it is rejecting nonsense, and one day is what that costs without knowing where they
  are.

The asymmetry is the whole argument. A strict UTC comparison *blocks a correct answer* and leaves the
respondent stuck; the tolerance *accepts a date at most one day beyond true* on a field where someone is
recalling a diagnosis from years ago. An outage against a rounding error in data quality.

Recorded as provisional rather than settled: [[2-design-doc#18. Open Questions]] §14 carries the alternative
— having the client submit its UTC offset and validating exactly — for revisiting if there is time.

**Implementation rider, either way.** The constraint evaluator in `@qp/shared` takes `today` as a parameter
and never calls `new Date()` itself. The server passes UTC today, the client passes local today, and every
timezone case becomes a unit test with no clock to mock.

## 3. Serialization

A published version is stored as a single JSONB document ([[2-design-doc#12. Database]] §12.1) and served to the client whole, once per session. The document carries its own `formatVersion` (§6.5).

```json
{
  "formatVersion": 1,
  "questionnaireId": "01a0950e-56a0-73d6-b936-4a1e10eff8c0",
  "version": 1,
  "title": "Patient Intake",
  "items": [
    {
      "itemId": "itm_01",
      "required": true,
      "visibleWhen": null,
      "question": {
        "questionId": "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
        "questionVersion": 1,
        "type": "single_choice",
        "prompt": "Do you have a medical condition?",
        "options": [
          { "optionId": "yes", "label": "Yes" },
          { "optionId": "no",  "label": "No"  }
        ]
      }
    },
    {
      "itemId": "itm_02",
      "required": true,
      "visibleWhen": { "all": [
        { "type": "single_choice", "itemId": "itm_01", "op": "is", "optionId": "yes" }
      ]},
      "question": {
        "questionId": "01a0950f-4161-7719-98fb-afa43f4c6232",
        "questionVersion": 3,
        "type": "single_choice",
        "prompt": "Which condition?",
        "options": [
          { "optionId": "opt_diabetes", "label": "Diabetes" },
          { "optionId": "opt_hyperten", "label": "Hypertension" },
          { "optionId": "other",        "label": "Other", "freeform": true }
        ]
      }
    },
    {
      "itemId": "itm_03",
      "required": true,
      "visibleWhen": { "all": [
        { "type": "single_choice", "itemId": "itm_01", "op": "is", "optionId": "yes" }
      ]},
      "question": {
        "questionId": "01a0950f-41c2-7435-a65e-c53680e09195",
        "questionVersion": 1,
        "type": "date",
        "prompt": "When were you diagnosed?",
        "relative": "not_future"
      }
    },
    {
      "itemId": "itm_04",
      "required": true,
      "visibleWhen": null,
      "question": {
        "questionId": "01a0950f-4223-73df-8544-fa8f63877e0b",
        "questionVersion": 1,
        "type": "text",
        "prompt": "Preferred pharmacy",
        "maxLength": 120
      }
    }
  ]
}
```

This is **version 1** of the seeded demo questionnaire. `itm_02` and `itm_03` are skipped entirely when the first question is answered `no`, and both paths converge on `itm_04` with no merge edge anywhere.

`questionId` is a uuid because a question is a row in the bank rather than a key inside the document (§2 of [[9-database-schema#2. Conventions]]); `itemId` and `optionId` stay authored slugs for the opposite reason. The four ids above are the ones the seed inserts — **the seed hardcodes them rather than generating them**, so a uuid copied out of this document queries the running database ([[2-design-doc#17. Decisions Log]] #35). Their `question.key` slugs, in item order, are `qst_has_condition`, `qst_which_condition`, `qst_diagnosed_on` and `qst_pharmacy`, and the questionnaire's is `qnr_intake`; the prose below refers to them by key.

Note that `qst_which_condition` sits at `questionVersion` 3 inside questionnaire version 1. Question versions and questionnaire versions are independent series — the question was revised twice in the bank before this questionnaire ever added it, and the item pinned whatever was current at that moment (§6.2).

### 3.1 Version 2 — the demo change

Version 2 makes exactly one change: `opt_hyperten`'s label becomes plainer, because respondents were not reliably recognising the clinical term. **The option id does not move.**

```json
{ "optionId": "opt_hyperten", "label": "High blood pressure (hypertension)" }
```

Relabelling is a save on the question bank, so `qst_which_condition` becomes `questionVersion` 4 and questionnaire version 2 pins that on `itm_02`. Nothing else in the document differs.

The reason this is the change worth shipping is that it puts a collected response at genuine risk and then shows the risk is not real. A version 1 respondent who selected hypertension stored `opt_hyperten`, not the label (§6.3), so:

- **Aggregation is unaffected.** v1 and v2 responses both count toward `opt_hyperten`, and "how many respondents reported hypertension" spans both versions with no mapping table.
- **Rendering stays version-correct.** The v1 response renders "Hypertension" and the v2 response renders "High blood pressure (hypertension)", because each resolves its label through the `questionVersion` it stored.

A design that copied labels onto responses, or that reissued option ids on edit, fails one of those two — and would look completely fine until someone ran the report. That is the failure this demo is built to make visible. See [[2-design-doc#17. Decisions Log]] #26.

Two changes were considered and left out. Rewording a prompt exercises the same mechanism, but the "meaning unchanged" claim is softer, since most rewordings worth making do shift the question slightly. Adding options, or adding a new conditional item, is monotone: nothing collected under v1 is at risk, so a passing test proves nothing was ever in danger. A predicate change also lives on the *item*, not the question, so it would not touch the append-only question-version mechanism the brief's "changes one question" points at — it is used instead as an integration fixture ([[8-testing#6. Test data and fixtures]]).

## 4. Branching rules

### 4.1 Representation

Each item carries an optional `visibleWhen` predicate: a **single level** of boolean grouping over typed conditions.

    visibleWhen: { all: [ <condition>, ... ] }
    visibleWhen: { any: [ <condition>, ... ] }

**A condition names an `itemId`, not a `questionId`** ([[2-design-doc#17. Decisions Log]] #41). An item is a placement, and "an earlier answer" is a property of the placement rather than of the reusable question — which is also the only reading that stays unambiguous if a question were ever placed twice. The condition's type still comes from the question: the referenced item pins a `questionVersion`, and that version's `type` is the discriminant (§4.2).

Nesting is not supported. One `all` or `any` over a flat list satisfies the brief's requirement for rules over *one or more* previous responses, and keeps both the admin rule editor and the validator comprehensible — a nested tree needs a recursive editor UI and recursive explanation for expressiveness this domain has not asked for. It also has a concrete payoff in §5.2: flat composition is what makes exact satisfiability checking affordable.

Deeper composition is a plausible future extension, and the escape hatch already exists without it: two conditions that would need nesting can usually be expressed as two items with separate predicates.

Empty `all` and `any` groups are representable in the schema rather than rejected outright. That is deliberate: it lets the engine's edge cases — what an empty group evaluates to — be exercised directly in a test, while what an empty group *means* stays the engine's decision rather than the schema's.

### 4.2 Conditions are typed per response type

There is no generic `{ itemId, op, value }` shape. The condition union is discriminated by the type of the question it references, so the operator set and the operand type travel together — comparing a date against a number, or asking whether a text answer is greater than 5, is unrepresentable at the type level in the shared package rather than a runtime error class to detect, message and test.

| Referenced type | Operators | Operand |
| --- | --- | --- |
| `text` | `answered` | boolean — `true` for answered, `false` for not answered |
| `single_choice` | `is`, `isNot`, `isAnyOf`, `isNoneOf` | option id(s) |
| `multiple_choice` | `includes`, `excludes`, `includesAnyOf`, `includesAllOf` | option id(s) |
| `number` | `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `between` | number, in the question's unit |
| `date` | `before`, `onOrBefore`, `after`, `onOrAfter`, `between` | date |

Text has no content-matching operators, for the reason in §2.3. Its one operator carries a boolean rather than coming as an `answered` / `notAnswered` pair, so the condition is `{ type: "text", itemId, op: "answered", value: boolean }`. Like every condition, it is `false` when the referenced item is hidden, for either value (§4.3).

Number conditions are expressed in the referenced question's unit. Because rules live on the questionnaire version and each item pins a specific question version, the unit is fixed for the life of that version and the comparison stays internally consistent. `between`, on both the `number` and `date` operators, is inclusive of both bounds.

### 4.3 Evaluation

The next question is **the first unanswered item, in list order, whose predicate evaluates true.** The questionnaire is complete when no such item remains.

**A condition referencing a question that was not shown evaluates to `false`** — for every operator and operand, including the negative ones, text `answered` with `value: false`, and a hidden item whose earlier answer is still held. `isNot` against an unanswered question is `false`, not `true`. Formally: a condition means *the referenced item is shown **and** its answer exists **and** satisfies the operator*. The one exception to "the answer exists" is text `answered` with `value: false`, which holds exactly when the item is shown and unanswered. Without this rule, `isNot`-style conditions would fire for every respondent who never reached the referenced question, which is the SQL `NULL` trap reproduced in a rule engine.

One evaluator, two callers: the client renders the next question with it, the server re-runs it on submit against stored answers and the pinned version. It lives in the shared workspace package so there is exactly one implementation.

## 5. Publish-time validation

Run inside the transaction that snapshots the version ([[2-design-doc#12. Database]] §12.1).

### 5.1 Why cycles and deadlock are not on this list

The brief asks for cycle and deadlock prevention. The model makes both inexpressible rather than detectable:

- **Predicates may reference only questions at a lower index**, so evaluation only ever moves forward and a cycle cannot be constructed.
- **Running off the end of the list is completion**, so there is no state in which a respondent has answered everything reachable but cannot terminate.

§5.2's forward-reference check is what upholds the first claim, which is why it is enforced rather than advisory.

### 5.2 Forward references

A predicate referencing an item at an equal or higher index rejects the publish. Because conditions name items (§4.1), this is a comparison of two list indices and has exactly one answer.

### 5.3 Satisfiability

Checked **exactly**, not by pattern-matching a few obvious contradictions. This is affordable precisely because composition is flat (§4.1): a single grouping level over typed conditions is decidable by domain intersection with no search. An arbitrary nested tree would have made the same check a SAT problem.

**Per-predicate.** Group an `all` group's conditions by referenced question and intersect each question's domain:

| Type | Domain | Unsatisfiable when |
| --- | --- | --- |
| `single_choice` | set of option ids — `is X` gives that one, `isNot X` the complement, `isAnyOf` / `isNoneOf` the set and its complement | the intersection is empty |
| `multiple_choice` | a required set and a forbidden set | the two overlap; or the required set exceeds `maxSelections`; or fewer options remain unforbidden than `minSelections` |
| `number` | an interval with punctures — bounds from `lt` / `lte` / `gt` / `gte` / `between` intersected with the question's own `min` / `max`, `eq` as a point, `neq` as a puncture | the interval is empty, or for an `integer` question contains no integer |
| `date` | an interval, same arithmetic over dates | the interval is empty |
| `text` | answered or not | `answered: true` and `answered: false` both present |

An `any` group is satisfiable if any single disjunct is, and each disjunct is one condition, so that case is trivial.

**Reachability is stronger than per-predicate satisfiability.** A predicate can be satisfiable alone while every question it references is itself gated by something contradictory. Because references point strictly backwards the items form a DAG, so this resolves bottom-up: for item *i*, accumulate the domain constraints of its own predicate together with those of its whole dependency closure, then check the combined map for an empty domain.

`any` groups make the closure non-conjunctive, so an exact answer enumerates disjunct combinations. We **enumerate exhaustively** and reject any item proven unreachable — an unreachable item is always an authoring error, and there is no second outcome to reason about. At realistic questionnaire sizes (closures two or three deep over a handful of conditions) the enumeration terminates immediately, and it runs once per publish rather than on the request path, so the cost is paid where it does not matter.

The worst case is exponential in the number of `any` disjuncts along a closure. Capping the enumeration and downgrading unproven items from *reject* to *warn* is the escape hatch if a questionnaire ever grows big enough to need it — see §8.

**Relative date constraints** (`not_future`, `not_past`) depend on evaluation time, so at publish time they are treated as non-empty and excluded from the intersection. They can never be the sole cause of an unsatisfiable result.

### 5.4 Referential integrity

Every `itemId` and `optionId` named by a predicate exists in the version, and the `type` of the question
version pinned by the referenced item is **identical** to the condition's `type`. The discriminant is the
question type with no mapping table and no exceptions — which is what removing `yes_no` as a type bought
([[2-design-doc#17. Decisions Log]] #36).

### 5.5 One placement per question

A question may appear at most once in a questionnaire version; a second placement rejects the publish.

This is not about ambiguity — conditions name items (§4.1), so two placements would each be addressable.
It is about aggregation. Two placements produce two `response` rows carrying the same `question_id` for a
single respondent, so "how many respondents reported hypertension" counts that person twice, and the
typed-column design in [[9-database-schema#6.1 `response`]] exists precisely to make that query an index
scan people will trust. Nothing legitimate is lost: question reuse is reuse *across* questionnaires, which
is the case [[9-database-schema#3.2 The question bank]] argues for. See [[2-design-doc#17. Decisions Log]] #41.

### 5.6 What needs no check

Required-ness. It is evaluated against the reachable path at submit time, so a required item whose predicate is false is simply not required for that respondent. The "required but unreachable" case resolves at execution, not authoring.

## 6. Versioning mechanics

Two independently versioned things — questionnaires and questions — plus the rule that a response must stay interpretable after either is revised.

### 6.1 Questionnaire versions

- At most one draft per questionnaire, enforced by a partial unique index on `questionnaire_id WHERE status = 'draft'` rather than by application logic.
- **Publishing promotes the draft row in place** to version *N*. Nothing is copied at publish time; the next draft is an explicit copy of the latest published version.
- A published version is never edited. The only way forward is a new draft derived from it.

### 6.2 Question identity and versioning

Questions are **append-only**. There is no draft state on the question bank: every save writes a new immutable `question_version` row, so saving *is* publishing — there is nothing mutable for a draft to protect. A question therefore has:

- a stable `questionId` — what makes it "the same question" across every revision and every questionnaire that uses it;
- an ordered series of `questionVersion`s, each an immutable snapshot of prompt, type and constraints.

**The response type is fixed by the first save.** Prompt and constraints may change from version to version; the type may not. A condition is typed to the question it reads (§4.2), so a new type would turn every rule reading that question into a `predicate/type-mismatch` in questionnaires the author cannot see, the next time one re-pins it. Appending a version whose type differs from the latest is `400 request/invalid` with `question/type-changed`, one of the question rules the editor makes unrepresentable ([[2-design-doc#17. Decisions Log]] #61). A different type is a different question.

**Saving is explicit.** Append-only means a naive autosave would spray versions, so the editor holds its working state client-side and writes only when the author commits — presented in the UI as closing out the edit dialog. One deliberate save, one version. This is the real cost of having no draft state on the bank, and it is a UI convention rather than a data-model one.

A typo fix therefore also creates a version, including on a question no published questionnaire has ever used. That is what append-only means, and it is better than a "mutable until first use" rule, which would be a second lifecycle hiding inside the first.

**Items pin at add time.** When an author adds a question to a questionnaire draft, the item records the `questionVersion` current at that moment and keeps it. A draft does not change under the author between sessions, and moving to a newer question version becomes a visible act rather than an invisible side effect of publishing.

There is no "upgrade this draft to the latest question versions" action yet (§8), so moving a questionnaire onto a newer question version means removing and re-adding the item. Clunky, deliberate, and written down rather than discovered.

**Questions are archived, never deleted** — hidden from the picker, but retained, because published snapshots reference their content forever. This is an instance of a general rule; see [[2-design-doc#3. Constraints]].

**Archiving means "not for new placements", and nothing more** ([[2-design-doc#17. Decisions Log]] #75). A placement is new when its `(questionId, questionVersion)` pair is not already in the stored draft; only a new one draws `draft/question-archived`, at save or at publish. An item already placed keeps its archived question through every save, into the next draft's copy, and through publish. Re-pinning that item to another version of the question is a new pair, so it is refused like any other new placement. The cost falls on remove-and-re-add: an archived question removed from a draft cannot be put back, since the picker does not offer it and there is no unarchive yet ([gh#17](https://github.com/kenziesimpson/questionnaire-platform/issues/17)). Re-creating it makes a new `questionId`, whose answers do not aggregate with the old one's (§6.3).

### 6.3 What a response stores

| Stored | Role |
| --- | --- |
| `questionId` | **What you aggregate on.** The stable identity that lets one question's answers be compared across versions — which is what makes "prior responses still mean the same thing" a property a test can assert rather than a claim. |
| `questionVersion` | **What you render with.** Resolves the exact prompt and option labels the respondent actually saw. |
| `questionnaireVersion` | The pinned definition, and the route to the full snapshot. |
| option ids, or `{ value, unit }` | The answer itself, in a form that does not depend on labels (§2.1, §2.2). |

`questionVersion` is strictly derivable: the questionnaire version's snapshot records each item's pinned `questionVersion`, so `(questionnaireVersion, questionId)` is enough to look it up. We store it anyway, for exactly the reason a number answer carries its unit — **a response should be interpretable without loading the definition it was collected under.** An export of the responses table is then self-describing, and a snapshot that ever failed to load would not take the responses' meaning down with it.

The line is drawn at the version pointer, not the text. Prompt and option labels are *not* copied onto the response: the unit is stored because it changes what the value means numerically (180 cm and 180 in are different answers), whereas prompt wording is context the snapshot already holds exactly, and duplicating it on every row would buy nothing.

### 6.4 Three layers of immutability enforcement

The brief treats this as the central invariant, and a single layer is one refactor away from being gone.

1. **Database.** A trigger rejects any `UPDATE` against a row whose status is `published`. This is the guarantee.
2. **API.** Authoring endpoints reject a mutation targeting a non-draft version with `409 Conflict` before it reaches the data layer, so callers get a useful error instead of a constraint violation surfacing as a 500.
3. **Tests.** A test drives the `UPDATE` straight at the database, bypassing the API, so the guarantee cannot silently regress when the service layer is refactored.

### 6.5 Snapshot format version

The snapshot is a JSON document with its own schema, and that schema evolves independently of the SQL schema. DDL migrations do not touch JSONB contents, so a document written today must still be readable a year from now.

- Every snapshot carries `formatVersion`.
- The loader holds upgrade functions from one format version to the next, applied **in memory at read time**. Stored bytes are never rewritten.
- Snapshots are validated with TypeBox on load, so a stale or corrupt document fails loudly instead of degrading into strange branching behaviour.

**Immutability here means the bytes, not the meaning.** Re-serializing a published version into a newer format is not permitted, even as a background migration that provably preserves semantics — hence read-time upgrades. The stored document is the evidentiary record of what a respondent was actually shown, and that argument does not survive rewriting it. How many past formats the loader commits to supporting is [[2-design-doc#18. Open Questions]] §4.

## 7. Alternatives considered

### 7.1 Questionnaire structure (Decisions Log #6)

- *Pointer / graph of questions.* Each question holds edges to its possible successors; branches are alternate edges. Rejected because every branch segment needs an explicit merge edge back to the trunk, and the authoring tool must *prove* all outbound paths reconverge or a branch strands the respondent. Inserting a question mid-questionnaire rewires every edge crossing that point, and cycles become constructible, so they have to be detected.
- *Adjacency-constrained optional segments* (the original ideation model, §9). Branch questions must sit immediately after their trigger; segments sharing a trigger group together. This buys convergence structurally and is genuinely neat, but it ties each branch to exactly one trigger question — and the brief requires rules over *one or more* previous responses. It also cannot express a condition over a branch question's own answer, which is the most natural multi-condition case in our own demo (`has_condition = yes AND condition = diabetes`).
- *Flat ordered list with predicates* (chosen). Order is the index, visibility is a predicate. Convergence stops being a property to prove and becomes the only thing available. The cost is no arbitrary jumps, no loops and no "skip to end" — none of which the brief asks for, and each of which would reintroduce the failure modes the model just eliminated.

### 7.2 Definition storage (Decisions Log #7)

- *Fully normalized published versions.* Copy draft rows into published item / option / rule rows marked immutable. Attractive because one model covers everything and reverse lookups are ordinary joins. Rejected: a four-way join plus row assembly on every session start, for a document that can never differ between reads; immutability spread across four tables; and the compile-to-evaluable-structure step is needed regardless, so the normalized form buys nothing on the execution path.
- *JSONB for drafts as well.* Rejected: kills the question-reuse query outright, and every field edit in the admin UI becomes a read-modify-write of the whole document with a lost-update window between concurrent editors.
- *Snapshot plus normalized authoring* (chosen), with a derived `version_question_index` restoring the one query the snapshot makes awkward.

### 7.3 Branch condition typing (Decisions Log #9)

- *Generic `{ questionId, op, value }`.* Simplest storage and the easiest rule editor to write. Rejected because nothing prevents `date before 5` or `text gt 10` being constructed, so every invalid combination becomes a runtime error class to detect, message and test — in an engine that runs in two places.
- *Arbitrary nested boolean tree.* Maximum expressiveness. Rejected: needs a recursive editor UI, recursive validation and recursive explanation, and would turn §5.3's exact satisfiability check into a SAT problem.
- *Per-type discriminated union under a single grouping level* (chosen). Invalid comparisons are unrepresentable in the shared package's types, so the rule engine has no type-mismatch branch at all.

### 7.4 Versioning as a git-like structure

Considered early (§9): treat questionnaire history as commits and diffs. Rejected because reading a version would mean reconstructing it by replaying history, which is exactly the wrong cost profile — the hot path is "give me published version N, whole, right now", and an immutable snapshot answers that in one row read.

### 7.5 Question versioning (Decisions Log #13)

- *Independently versioned bank with its own draft/publish lifecycle.* Questions get drafts, publishing and version history exactly parallel to questionnaires — the most literal reading of the brief's "version questions and questionnaires". Rejected for the prototype: a second complete draft-to-publish flow to build, test and explain, doubling the authoring surface for a benefit the demo never exercises. **Not foreclosed** — it is the chosen model plus a mutable working copy in front of the version table, so the `question_version` rows keep their shape and a draft row collapses into one on commit. Additive, not a rewrite.
- *Questions as mutable templates, versioning only at the questionnaire level.* The bank holds current content; publishing freezes it into the snapshot. Simplest of the three, and the snapshot already does the freezing. Rejected because the brief asks for questions themselves to be versioned, and because "what did this question look like in March?" would only be answerable through some questionnaire that happened to use it.
- *Append-only question versions, no bank draft state* (chosen). Saving is publishing because nothing is mutable. Real question versioning, but the bank's lifecycle is inserting a row rather than a parallel state machine, and it composes with the snapshot instead of duplicating it: `question_version` is the authoring-side record of what a question has ever been, the snapshot is the execution-side record of what a respondent actually saw. Two records with genuinely different jobs, where the independently versioned bank would have had two doing the same one.

## 8. Future changes noted

Deliberate simplifications, recorded so they are recognisable as choices rather than oversights. None of these are open questions — they are settled for the prototype.

| Simplification | Why it is fine now | What would change it |
| --- | --- | --- |
| Rules cannot match `otherText` (§2.3) | Text matching is fragile and has no version-stable identity | Promotion of recurring freeform answers into real options, rather than string matching in the engine |
| Single level of boolean composition (§4.1) | Covers "one or more previous responses"; two conditions needing nesting can be split across two items | Demand for genuinely nested logic, at the cost of the exact satisfiability check |
| No unit conversion (§2.2) | Answers already carry their unit, so conversion is additive | A questionnaire that needs mixed-unit entry or cross-version analytics |
| No `text` format subtypes | Length validation covers the prototype's needs | [[2-design-doc#18. Open Questions]] §2 |
| No draft state on the question bank (§6.2) | Saving is explicit, so one save is one version | Authors needing to park half-finished question edits — that is the independently versioned bank in §7.5 |
| No "upgrade draft to latest question versions" action (§6.2) | Remove and re-add the item; rare at prototype scale | More than a handful of questions in flight, where re-adding items by hand stops being reasonable |
| Reachability checked by exhaustive enumeration (§5.3) | Real closures are shallow; validation runs once per publish, off the request path | A questionnaire large enough to make the enumeration slow — then cap it and downgrade unproven items from reject to warn |

## 9. Appendix — original ideation

Kept as the record of how the model was arrived at. Where this appendix and the sections above disagree, the sections above win.

### Ideation
Potential insight: I think this is an analogous problem to git (but I didn't want to leverage git here because having to reconstruct every time is a major drawback)

Other approach concept: questions can have an id and also be indexed on a version. Maybe we just have to copy each question for each version?

for versioning, I think we can simplify to just having one draft version at a time (globally as well)

Something that occurred to me that could be included but I think it unnecessary is the ability to a/b the questionnaires themselves, that could come in the future.

For sake of simplicity, let's say that optional questions can only be next to their triggers (or next to other optional questions triggered by the same question) and must go after?

This gives us another win: we can verify that the optional question sequences all end up pointing to the same next question

Implicit assumption: each question is one entry in the db with connections to other entries, so structure is pointer-based.

Challenge, how do we determine order in optional questions?
> Suppose you have question A with standard next question B, but optional segments C and D. How do we decide the order of C and D?

Big question: how do we store answers??? their type is based off of the questions, but obviously if questions update frequently we can't have a set schema for answers, so maybe we have to serialize/deserialize

It's becoming clear that we need a system that reads questions from the db and converts them to some form that the backend is familiar with for parsing incoming answers

### Question types
Broadly true: answers to non-optional questions can be used to trigger an optional segment
#### Checkbox
One, two, three or n options.
Select one or select multiple (needs special consideration for the one option)
The ability to have the last option be an other/freeform response

Each box should have the ability to connect to another entry/set of entries

#### Text box
Short form and long-form

#### Number
Constraints: integer/float, min, max, unit
	maybe integer/float is a toggle, it has to be one or the other, others optional

open question: how do we want to deal with units?
	future work would be allowing to switch between different compatible units (cm/in, etc.) and then tagging answers with the unit

optional segments can be triggered for answers <, <=, >, >=, \==, or != some value
	This highlights need for multuple options per entry, do we need to store those separately...?

#### Date
Constraints: min, max

Out of scope for now, date range, that can be formed from two dates (although it has different validation that could be applied)