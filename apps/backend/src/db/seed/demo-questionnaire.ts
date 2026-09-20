import { draftItemOf, questionInputOf, type Item, type PublishedDefinition } from "@qp/shared";
import {
  INTAKE_EARLIER_REVISIONS,
  INTAKE_ITEM_IDS,
  INTAKE_QUESTION_KEYS,
  INTAKE_QUESTION_ROLES,
  INTAKE_QUESTIONNAIRE_ID,
  INTAKE_QUESTIONNAIRE_KEY,
  intakeDefinition,
  type IntakeQuestionRole,
} from "@qp/shared/demo";
import { eq } from "drizzle-orm";
import type { Database, Transaction } from "../client.js";
import { mustExist } from "../errors.js";
import { publishDraft } from "../definition/publish.js";
import { replaceDraft } from "../definition/drafts.js";
import { createQuestionnaire } from "../definition/questionnaires.js";
import { readOpenDraft } from "../definition/questionnaire-version-rows.js";
import { appendQuestionVersion, createQuestion } from "../definition/questions.js";
import { questionnaire } from "../schema.js";

const SEED_ACTOR = "seed";

export type DemoSeedOutcome = "seeded" | "already-seeded";

function intakeItem(demo: PublishedDefinition, role: IntakeQuestionRole): Item {
  const item = demo.items.find((candidate) => candidate.itemId === INTAKE_ITEM_IDS[role]);
  if (item === undefined) {
    throw new Error(`the intake definition has no item ${INTAKE_ITEM_IDS[role]}`);
  }
  return item;
}

async function saveBankHistoryFor(tx: Transaction, role: IntakeQuestionRole, item: Item): Promise<void> {
  const { questionId, questionVersion } = item.question;
  const common = { createdBy: SEED_ACTOR, traceId: null };
  const [first, ...later] = [...INTAKE_EARLIER_REVISIONS[role], questionInputOf(item.question)];

  let saved = await createQuestion(tx, { seededQuestionId: questionId, key: INTAKE_QUESTION_KEYS[role], content: first, ...common });
  for (const content of later) {
    const appended = await appendQuestionVersion(tx, { questionId, content, ...common });
    if (appended.outcome !== "saved") {
      throw new Error(`question ${questionId} was not appended while seeding: ${appended.outcome}`);
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

    for (const role of INTAKE_QUESTION_ROLES) {
      await saveBankHistoryFor(tx, role, intakeItem(demo, role));
    }

    await createQuestionnaire(tx, {
      seededQuestionnaireId: INTAKE_QUESTIONNAIRE_ID,
      key: INTAKE_QUESTIONNAIRE_KEY,
      name: demo.title,
      title: demo.title,
      createdBy: SEED_ACTOR,
      traceId: null,
    });
    const opened = mustExist(await readOpenDraft(tx, INTAKE_QUESTIONNAIRE_ID), "demo-draft.unreadable-after-create", { questionnaireId: INTAKE_QUESTIONNAIRE_ID });
    const edited = await replaceDraft(tx, {
      questionnaireId: INTAKE_QUESTIONNAIRE_ID,
      precondition: { versionId: opened.id, draftRevision: opened.draftRevision },
      title: demo.title,
      items: demo.items.map(draftItemOf),
      actorId: SEED_ACTOR,
      traceId: null,
    });
    if (edited.outcome !== "saved") {
      throw new Error(`demo draft items were not saved: ${edited.outcome}`);
    }
    const published = await publishDraft(tx, {
      questionnaireId: INTAKE_QUESTIONNAIRE_ID,
      precondition: { versionId: edited.draft.versionId, draftRevision: edited.draftRevision },
      actorId: SEED_ACTOR,
      traceId: null,
    });
    if (published.outcome !== "published") {
      throw new Error(`demo questionnaire was not published: ${JSON.stringify(published)}`);
    }
    return "seeded";
  });
}
