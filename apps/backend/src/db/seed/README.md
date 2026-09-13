# Seed

Seeds the medical-condition demo questionnaire the brief requires. `seed.ts` is the entry point the compose
`migrate` service runs after migrations. `demo-questionnaire.ts` does the work.

## What gets seeded

The intake questionnaire (`qnr_intake`, "Patient Intake") and the four questions it places. Only
**questionnaire version 1** is published.

| Question key | Bank versions created | Pinned by v1 |
| --- | --- | --- |
| `qst_has_condition` | 1 | 1 |
| `qst_which_condition` | 1, 2, 3 | 3 |
| `qst_diagnosed_on` | 1 | 1 |
| `qst_pharmacy` | 1 | 1 |

The v1 snapshot is not written here. It comes from `intakeDefinition(1)` in
[`packages/shared/src/demo/intake.ts`](../../../../../packages/shared/src/demo/intake.ts), the one demo definition
the seed and the test fixtures share ([`docs/8-testing.md`](../../../../../docs/8-testing.md) §6). Each item's
pinned question content becomes that question's bank version, and the seed fails if a saved version number
differs from the pin.

`qst_which_condition` versions 1 and 2 are **placeholder content**. The docs say only that the question was
"revised twice" before v1 placed version 3 ([`docs/5-questionnaire-format.md`](../../../../../docs/5-questionnaire-format.md) §3).

Version 2 of the questionnaire (the `opt_hyperten` relabel, question version 4) is **not** seeded. End-to-end
spec 3 publishes it.

## Hardcoded ids

The questionnaire and question ids are fixed constants (`INTAKE_QUESTIONNAIRE_ID`, `INTAKE_QUESTION_IDS`), so a
uuid copied out of the format doc queries a running database (Decisions Log #35). Everything else, including
the questionnaire version row, sessions and responses, gets a generated id.

## How it publishes

Through the same repository functions the definition API uses: `createQuestion` and `appendQuestionVersion`,
then `createQuestionnaire`, `replaceDraft` and `publishDraft`. `publishDraft` runs `validateDraft` and then
`definition.promote_draft`. The database refuses to insert a published row, and `qp_definition` cannot
update the publish columns, so there is no shortcut to take. Every `docker compose up` therefore exercises
publish validation, snapshot serialization, `version_question_index`, the current-version pointer and the
audit trail ([`docs/9-database-schema.md`](../../../../../docs/9-database-schema.md) §11.6). The whole seed is one
transaction.

## Runs as `qp_definition`

The `migrate` service applies migrations as `qp_owner`, then runs the seed with `DATABASE_URL_DEFINITION`. The
seed runs as the same role, under the same grants, as the definition API: column-level `UPDATE`, `EXECUTE` on
`promote_draft` and `audit.record`, no access to `execution`. `qp_owner` owns every table and would pass checks the
real path has to pass legitimately, so seeding as the owner would prove nothing about those grants.

## Idempotent

If the intake questionnaire already exists, the seed does nothing and prints
`Seed: demo questionnaire already-seeded.`, so repeated `docker compose up` runs are safe.
`docker compose down -v` is the only reset.

## Running it locally

```bash
docker compose up db
npm run db:migrate -w apps/backend
npm run db:seed -w apps/backend
```

Both need the connection strings from the root [`.env.example`](../../../../../.env.example) exported
(`DATABASE_URL_OWNER` for migrate, `DATABASE_URL_DEFINITION` for the seed).
`_tests/db/seed/demo-questionnaire.test.ts` covers it against Testcontainers.
