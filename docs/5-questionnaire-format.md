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

## 2. Question types

Six response types. Constraints belong to the question version and compile into a validator at publish time.

| Type | Constraints | Notes |
| --- | --- | --- |
| `text` | `minLength`, `maxLength`, `multiline` | `multiline` distinguishes short answer from long form. Format subtypes (email, phone, regex) are deferred — [[2-design-doc#18. Open Questions]] §4. |
| `single_choice` | `options` (at least one), optional freeform `other` | Exactly one selection. |
| `multiple_choice` | `options` (at least one), `minSelections`, `maxSelections`, optional freeform `other` | `minSelections` of 1 or more is how "required, pick at least one" is expressed. |
| `number` | `numberKind` (`integer` or `float`, required), `min`, `max`, `unit` | `unit` is a display label; conversion between compatible units is future work. |
| `date` | `min` / `max` (absolute), `relative` (`not_future`, `not_past`) | Relative constraints let "when were you diagnosed?" reject future dates without baking a fixed date into the definition. Date *ranges* are out of scope — model as two date questions. |
| `yes_no` | — | Sugar over `single_choice` with reserved option ids `yes` / `no` and a `display: yes_no` render hint. Identical storage shape to any choice question, so there is one set of choice operators rather than two. |

### 2.1 Option ids are stable across question versions

Rewording an option's label does not change the identity of responses already collected against it. Rules reference option ids, never labels, so a relabelling version bump cannot change what a rule means either.

This is the mechanism that makes the brief's "change one question without changing the meaning of responses already collected" demonstrably true rather than asserted, and it is what the v2 demo should exercise.

### 2.2 Number answers carry their unit

A stored answer is `{ value, unit }`, not a bare number. A later version that switches `cm` to `in` therefore cannot retroactively change what an earlier answer meant. The unit is duplicated from the question version deliberately: a response must be interpretable without joining back to the definition it was collected under.

### 2.3 The `other` option

A choice question may mark a trailing option as freeform. The answer then has two parts — the selected option ids (one being `other`) and an `otherText` string — so the stored shape for every choice question carries an optional `otherText`, validated with the same length rules as a `text` question.

**Rules may test whether `other` was selected; they may not match against the text.** Kept deliberately simple: text matching in rules is fragile and there is no version-stable identity to match on. If `otherText` ever needs to drive a branch, the likely shape is a promotion workflow — an admin converts a recurring freeform answer into a real option in the next version — rather than string matching in the rule engine. Noted as a possible future change, not a current limitation to design around.

## 3. Serialization

A published version is stored as a single JSONB document ([[2-design-doc#12. Database]] §12.1) and served to the client whole, once per session. The document carries its own `formatVersion` (§5.5).

```json
{
  "formatVersion": 1,
  "questionnaireId": "qnr_intake",
  "version": 2,
  "title": "Patient Intake",
  "items": [
    {
      "itemId": "itm_01",
      "required": true,
      "visibleWhen": null,
      "question": {
        "questionId": "qst_has_condition",
        "questionVersion": 1,
        "type": "yes_no",
        "prompt": "Do you have a medical condition?",
        "display": "yes_no",
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
        { "type": "single_choice", "questionId": "qst_has_condition", "op": "is", "optionId": "yes" }
      ]},
      "question": {
        "questionId": "qst_which_condition",
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
        { "type": "single_choice", "questionId": "qst_has_condition", "op": "is", "optionId": "yes" }
      ]},
      "question": {
        "questionId": "qst_diagnosed_on",
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
        "questionId": "qst_pharmacy",
        "questionVersion": 1,
        "type": "text",
        "prompt": "Preferred pharmacy",
        "maxLength": 120
      }
    }
  ]
}
```

This is the seeded demo questionnaire. `itm_02` and `itm_03` are skipped entirely when `qst_has_condition` is answered `no`, and both paths converge on `itm_04` with no merge edge anywhere.

## 4. Branching rules

### 4.1 Representation

Each item carries an optional `visibleWhen` predicate: a **single level** of boolean grouping over typed conditions.

    visibleWhen: { all: [ <condition>, ... ] }
    visibleWhen: { any: [ <condition>, ... ] }

Nesting is not supported. One `all` or `any` over a flat list satisfies the brief's requirement for rules over *one or more* previous responses, and keeps both the admin rule editor and the validator comprehensible — a nested tree needs a recursive editor UI and recursive explanation for expressiveness this domain has not asked for. It also has a concrete payoff in §5.2: flat composition is what makes exact satisfiability checking affordable.

Deeper composition is a plausible future extension, and the escape hatch already exists without it: two conditions that would need nesting can usually be expressed as two items with separate predicates.

### 4.2 Conditions are typed per response type

There is no generic `{ questionId, op, value }` shape. The condition union is discriminated by the type of the question it references, so the operator set and the operand type travel together — comparing a date against a number, or asking whether a text answer is greater than 5, is unrepresentable at the type level in the shared package rather than a runtime error class to detect, message and test.

| Referenced type | Operators | Operand |
| --- | --- | --- |
| `text` | `answered`, `notAnswered` | — |
| `single_choice` / `yes_no` | `is`, `isNot`, `isAnyOf`, `isNoneOf` | option id(s) |
| `multiple_choice` | `includes`, `excludes`, `includesAnyOf`, `includesAllOf` | option id(s) |
| `number` | `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `between` | number, in the question's unit |
| `date` | `before`, `onOrBefore`, `after`, `onOrAfter`, `between` | date |

Text has no content-matching operators, for the reason in §2.3.

Number conditions are expressed in the referenced question's unit. Because rules live on the questionnaire version and each item pins a specific question version, the unit is fixed for the life of that version and the comparison stays internally consistent.

### 4.3 Evaluation

The next question is **the first unanswered item, in list order, whose predicate evaluates true.** The questionnaire is complete when no such item remains.

**A condition referencing a question that was not shown evaluates to `false`** — for every operator, including the negative ones. `isNot` against an unanswered question is `false`, not `true`. Formally: a condition means *the answer exists **and** satisfies the operator*. Without this rule, `isNot`-style conditions would fire for every respondent who never reached the referenced question, which is the SQL `NULL` trap reproduced in a rule engine.

One evaluator, two callers: the client renders the next question with it, the server re-runs it on submit against stored answers and the pinned version. It lives in the shared workspace package so there is exactly one implementation.

## 5. Publish-time validation

Run inside the transaction that snapshots the version ([[2-design-doc#12. Database]] §12.1).

### 5.1 Why cycles and deadlock are not on this list

The brief asks for cycle and deadlock prevention. The model makes both inexpressible rather than detectable:

- **Predicates may reference only questions at a lower index**, so evaluation only ever moves forward and a cycle cannot be constructed.
- **Running off the end of the list is completion**, so there is no state in which a respondent has answered everything reachable but cannot terminate.

§5.2's forward-reference check is what upholds the first claim, which is why it is enforced rather than advisory.

### 5.2 Forward references

A predicate referencing a question at an equal or higher index rejects the publish.

### 5.3 Satisfiability

Checked **exactly**, not by pattern-matching a few obvious contradictions. This is affordable precisely because composition is flat (§4.1): a single grouping level over typed conditions is decidable by domain intersection with no search. An arbitrary nested tree would have made the same check a SAT problem.

**Per-predicate.** Group an `all` group's conditions by referenced question and intersect each question's domain:

| Type | Domain | Unsatisfiable when |
| --- | --- | --- |
| `single_choice` / `yes_no` | set of option ids — `is X` gives that one, `isNot X` the complement, `isAnyOf` / `isNoneOf` the set and its complement | the intersection is empty |
| `multiple_choice` | a required set and a forbidden set | the two overlap; or the required set exceeds `maxSelections`; or fewer options remain unforbidden than `minSelections` |
| `number` | an interval with punctures — bounds from `lt` / `lte` / `gt` / `gte` / `between` intersected with the question's own `min` / `max`, `eq` as a point, `neq` as a puncture | the interval is empty, or for an `integer` question contains no integer |
| `date` | an interval, same arithmetic over dates | the interval is empty |
| `text` | answered or not | `answered` and `notAnswered` both present |

An `any` group is satisfiable if any single disjunct is, and each disjunct is one condition, so that case is trivial.

**Reachability is stronger than per-predicate satisfiability.** A predicate can be satisfiable alone while every question it references is itself gated by something contradictory. Because references point strictly backwards the items form a DAG, so this resolves bottom-up: for item *i*, accumulate the domain constraints of its own predicate together with those of its whole dependency closure, then check the combined map for an empty domain.

`any` groups make the closure non-conjunctive, so an exact answer enumerates disjunct combinations — exponential in the worst case, though real closures are two or three deep over a handful of conditions. We enumerate with a budget and treat the two outcomes differently:

- **Provably unsatisfiable** — reject the publish. This is always an authoring error.
- **Not proven satisfiable within the budget** — warn and allow the publish. A false warning is cheap; a false rejection blocks legitimate work.

**Relative date constraints** (`not_future`, `not_past`) depend on evaluation time, so at publish time they are treated as non-empty and excluded from the intersection. They can never be the sole cause of an unsatisfiable result.

### 5.4 Referential integrity

Every `questionId` and `optionId` named by a predicate exists in the version, and the referenced question's type matches the condition's type.

### 5.5 What needs no check

Required-ness. It is evaluated against the reachable path at submit time, so a required item whose predicate is false is simply not required for that respondent. The "required but unreachable" case resolves at execution, not authoring.

## 6. Versioning mechanics

Questionnaire-level only. Question-level identity — the split between a stable question id and an immutable question version, and what a response pins to — is [[2-design-doc#18. Open Questions]] §1–2.

### 6.1 Drafts and publishing

- At most one draft per questionnaire, enforced by a partial unique index on `questionnaire_id WHERE status = 'draft'` rather than by application logic.
- **Publishing promotes the draft row in place** to version *N*. Nothing is copied at publish time; the next draft is an explicit copy of the latest published version.
- A published version is never edited. The only way forward is a new draft derived from it.

### 6.2 Three layers of immutability enforcement

The brief treats this as the central invariant, and a single layer is one refactor away from being gone.

1. **Database.** A trigger rejects any `UPDATE` against a row whose status is `published`. This is the guarantee.
2. **API.** Authoring endpoints reject a mutation targeting a non-draft version with `409 Conflict` before it reaches the data layer, so callers get a useful error instead of a constraint violation surfacing as a 500.
3. **Tests.** A test drives the `UPDATE` straight at the database, bypassing the API, so the guarantee cannot silently regress when the service layer is refactored.

### 6.3 Snapshot format version

The snapshot is a JSON document with its own schema, and that schema evolves independently of the SQL schema. DDL migrations do not touch JSONB contents, so a document written today must still be readable a year from now.

- Every snapshot carries `formatVersion`.
- The loader holds upgrade functions from one format version to the next, applied **in memory at read time**. Stored bytes are never rewritten.
- Snapshots are validated with TypeBox on load, so a stale or corrupt document fails loudly instead of degrading into strange branching behaviour.

**Immutability here means the bytes, not the meaning.** Re-serializing a published version into a newer format is not permitted, even as a background migration that provably preserves semantics — hence read-time upgrades. The stored document is the evidentiary record of what a respondent was actually shown, and that argument does not survive rewriting it. How many past formats the loader commits to supporting is [[2-design-doc#18. Open Questions]] §6.

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

## 8. Future changes noted

Deliberate simplifications, recorded so they are recognisable as choices rather than oversights. None of these are open questions — they are settled for the prototype.

| Simplification | Why it is fine now | What would change it |
| --- | --- | --- |
| Rules cannot match `otherText` (§2.3) | Text matching is fragile and has no version-stable identity | Promotion of recurring freeform answers into real options, rather than string matching in the engine |
| Single level of boolean composition (§4.1) | Covers "one or more previous responses"; two conditions needing nesting can be split across two items | Demand for genuinely nested logic, at the cost of the exact satisfiability check |
| No unit conversion (§2.2) | Answers already carry their unit, so conversion is additive | A questionnaire that needs mixed-unit entry or cross-version analytics |
| No `text` format subtypes | Length validation covers the prototype's needs | [[2-design-doc#18. Open Questions]] §4 |

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