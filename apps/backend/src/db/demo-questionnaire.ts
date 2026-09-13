import type { DraftItem, Predicate, QuestionInput } from "@qp/shared";
import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { publishDraft, type PublishRules } from "./definition/publish.js";
import { replaceDraft, createQuestionnaire } from "./definition/questionnaires.js";
import { appendQuestionVersion, createQuestion } from "./definition/questions.js";
import { questionnaire } from "./schema.js";

export const DEMO_QUESTIONNAIRE_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";

export const DEMO_QUESTION_IDS = {
  hasCondition: "01a0950f-4100-7fcc-8acc-05dc6b75ce33",
  whichCondition: "01a0950f-4161-7719-98fb-afa43f4c6232",
  diagnosedOn: "01a0950f-41c2-7435-a65e-c53680e09195",
  pharmacy: "01a0950f-4223-73df-8544-fa8f63877e0b",
} as const;

const SEED_ACTOR = "seed";

const hasConditionV1: QuestionInput = {
  type: "single_choice",
  prompt: "Do you have a medical condition?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
};

const whichConditionRevisions: readonly QuestionInput[] = [
  {
    type: "single_choice",
    prompt: "Which medical condition do you have?",
    options: [
      { optionId: "opt_diabetes", label: "Diabetes" },
      { optionId: "opt_hyperten", label: "Hypertension" },
    ],
  },
  {
    type: "single_choice",
    prompt: "Which condition?",
    options: [
      { optionId: "opt_diabetes", label: "Diabetes" },
      { optionId: "opt_hyperten", label: "Hypertension" },
    ],
  },
  {
    type: "single_choice",
    prompt: "Which condition?",
    options: [
      { optionId: "opt_diabetes", label: "Diabetes" },
      { optionId: "opt_hyperten", label: "Hypertension" },
      { optionId: "other", label: "Other", freeform: true },
    ],
  },
];

const diagnosedOnV1: QuestionInput = {
  type: "date",
  prompt: "When were you diagnosed?",
  relative: "not_future",
};

const pharmacyV1: QuestionInput = {
  type: "text",
  prompt: "Preferred pharmacy",
  maxLength: 120,
};

const answeredYesToItem01: Predicate = { all: [{ type: "single_choice", itemId: "itm_01", op: "is", optionId: "yes" }] };

const demoItems: readonly DraftItem[] = [
  { itemId: "itm_01", required: true, visibleWhen: null, questionId: DEMO_QUESTION_IDS.hasCondition, questionVersion: 1 },
  {
    itemId: "itm_02",
    required: true,
    visibleWhen: answeredYesToItem01,
    questionId: DEMO_QUESTION_IDS.whichCondition,
    questionVersion: 3,
  },
  {
    itemId: "itm_03",
    required: true,
    visibleWhen: answeredYesToItem01,
    questionId: DEMO_QUESTION_IDS.diagnosedOn,
    questionVersion: 1,
  },
  { itemId: "itm_04", required: true, visibleWhen: null, questionId: DEMO_QUESTION_IDS.pharmacy, questionVersion: 1 },
];

export type DemoSeedOutcome = "seeded" | "already-seeded";

export async function seedDemoQuestionnaire<Failure>(
  db: Database,
  rules: PublishRules<Failure>,
): Promise<DemoSeedOutcome> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: questionnaire.id })
      .from(questionnaire)
      .where(eq(questionnaire.id, DEMO_QUESTIONNAIRE_ID));
    if (existing.length > 0) {
      return "already-seeded";
    }

    const common = { createdBy: SEED_ACTOR, traceId: null };
    await createQuestion(tx, { questionId: DEMO_QUESTION_IDS.hasCondition, key: "qst_has_condition", content: hasConditionV1, ...common });
    const [firstRevision, ...laterRevisions] = whichConditionRevisions;
    if (firstRevision === undefined) {
      throw new Error("the demo condition question needs at least one revision");
    }
    await createQuestion(tx, { questionId: DEMO_QUESTION_IDS.whichCondition, key: "qst_which_condition", content: firstRevision, ...common });
    for (const revision of laterRevisions) {
      await appendQuestionVersion(tx, { questionId: DEMO_QUESTION_IDS.whichCondition, content: revision, ...common });
    }
    await createQuestion(tx, { questionId: DEMO_QUESTION_IDS.diagnosedOn, key: "qst_diagnosed_on", content: diagnosedOnV1, ...common });
    await createQuestion(tx, { questionId: DEMO_QUESTION_IDS.pharmacy, key: "qst_pharmacy", content: pharmacyV1, ...common });

    const created = await createQuestionnaire(tx, {
      questionnaireId: DEMO_QUESTIONNAIRE_ID,
      key: "qnr_intake",
      name: "Patient Intake",
      title: "Patient Intake",
      ...common,
    });
    const edited = await replaceDraft(tx, {
      questionnaireId: DEMO_QUESTIONNAIRE_ID,
      expectedDraftRevision: created.draftRevision,
      title: "Patient Intake",
      items: demoItems,
      actorId: SEED_ACTOR,
      traceId: null,
    });
    if (edited.outcome !== "saved") {
      throw new Error(`demo draft items were not saved: ${edited.outcome}`);
    }
    const published = await publishDraft(tx, {
      questionnaireId: DEMO_QUESTIONNAIRE_ID,
      expectedDraftRevision: edited.draftRevision,
      rules,
      actorId: SEED_ACTOR,
      traceId: null,
    });
    if (published.outcome !== "published") {
      throw new Error(`demo questionnaire was not published: ${published.outcome}`);
    }
    return "seeded";
  });
}
