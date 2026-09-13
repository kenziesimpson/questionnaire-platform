import {
  INTAKE_QUESTION_IDS,
  INTAKE_QUESTIONNAIRE_ID,
  intakeDefinition,
  type Item,
  type QuestionContent,
  type QuestionInput,
} from "@qp/shared";
import { eq } from "drizzle-orm";
import type { Database, Transaction } from "../client.js";
import { publishDraft } from "../definition/publish.js";
import { createQuestionnaire, replaceDraft } from "../definition/questionnaires.js";
import { appendQuestionVersion, createQuestion } from "../definition/questions.js";
import { questionnaire } from "../schema.js";

const SEED_ACTOR = "seed";

const QUESTION_KEYS: Record<string, string> = {
  [INTAKE_QUESTION_IDS.hasCondition]: "qst_has_condition",
  [INTAKE_QUESTION_IDS.whichCondition]: "qst_which_condition",
  [INTAKE_QUESTION_IDS.diagnosedOn]: "qst_diagnosed_on",
  [INTAKE_QUESTION_IDS.pharmacy]: "qst_pharmacy",
};

const EARLIER_WHICH_CONDITION_REVISIONS: readonly QuestionInput[] = [
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
];

export type DemoSeedOutcome = "seeded" | "already-seeded";

function asQuestionInput(content: QuestionContent): QuestionInput {
  const { questionId: _questionId, questionVersion: _questionVersion, ...input } = content;
  return input;
}

async function saveBankHistoryFor(tx: Transaction, item: Item): Promise<void> {
  const { questionId, questionVersion } = item.question;
  const common = { createdBy: SEED_ACTOR, traceId: null };
  const earlier = questionId === INTAKE_QUESTION_IDS.whichCondition ? EARLIER_WHICH_CONDITION_REVISIONS : [];
  const revisions = [...earlier, asQuestionInput(item.question)];
  const [first, ...later] = revisions;
  if (first === undefined) {
    throw new Error(`no revisions to seed for question ${questionId}`);
  }

  let saved = await createQuestion(tx, { questionId, key: QUESTION_KEYS[questionId] ?? null, content: first, ...common });
  for (const content of later) {
    const appended = await appendQuestionVersion(tx, { questionId, content, ...common });
    if (appended.outcome !== "saved") {
      throw new Error(`question ${questionId} disappeared while seeding`);
    }
    saved = appended;
  }
  if (saved.questionVersion !== questionVersion) {
    throw new Error(`seeded question ${questionId} at version ${saved.questionVersion}, the demo pins ${questionVersion}`);
  }
}

export async function seedDemoQuestionnaire(db: Database): Promise<DemoSeedOutcome> {
  const demo = intakeDefinition(1);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: questionnaire.id })
      .from(questionnaire)
      .where(eq(questionnaire.id, INTAKE_QUESTIONNAIRE_ID));
    if (existing.length > 0) {
      return "already-seeded";
    }

    for (const item of demo.items) {
      await saveBankHistoryFor(tx, item);
    }

    const created = await createQuestionnaire(tx, {
      questionnaireId: INTAKE_QUESTIONNAIRE_ID,
      key: "qnr_intake",
      name: demo.title,
      title: demo.title,
      createdBy: SEED_ACTOR,
      traceId: null,
    });
    const edited = await replaceDraft(tx, {
      questionnaireId: INTAKE_QUESTIONNAIRE_ID,
      expectedDraftRevision: created.draftRevision,
      title: demo.title,
      items: demo.items.map((item) => ({
        itemId: item.itemId,
        required: item.required,
        visibleWhen: item.visibleWhen,
        questionId: item.question.questionId,
        questionVersion: item.question.questionVersion,
      })),
      actorId: SEED_ACTOR,
      traceId: null,
    });
    if (edited.outcome !== "saved") {
      throw new Error(`demo draft items were not saved: ${edited.outcome}`);
    }
    const published = await publishDraft(tx, {
      questionnaireId: INTAKE_QUESTIONNAIRE_ID,
      expectedDraftRevision: edited.draftRevision,
      actorId: SEED_ACTOR,
      traceId: null,
    });
    if (published.outcome !== "published") {
      throw new Error(`demo questionnaire was not published: ${JSON.stringify(published)}`);
    }
    return "seeded";
  });
}
