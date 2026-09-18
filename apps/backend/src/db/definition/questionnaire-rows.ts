import { eq } from "drizzle-orm";
import type { Executor, Transaction } from "../client.js";
import { questionnaire } from "../schema.js";

export interface RowsById<Row> extends PromiseLike<Row[]> {
  for(strength: "update"): PromiseLike<Row[]>;
}

export async function lockedRow<Row>(rows: RowsById<Row>): Promise<Row | undefined> {
  const [locked] = await rows.for("update");
  return locked;
}

export async function rowExists(rows: RowsById<unknown>): Promise<boolean> {
  return (await rows).length === 1;
}

export interface LockedQuestionnaire {
  readonly id: string;
  readonly closesAt: Date | null;
}

export interface QuestionnaireNotFound {
  readonly outcome: "questionnaire-not-found";
}

const QUESTIONNAIRE_NOT_FOUND: QuestionnaireNotFound = { outcome: "questionnaire-not-found" };

function selectQuestionnaire(executor: Executor, questionnaireId: string): RowsById<LockedQuestionnaire> {
  return executor
    .select({ id: questionnaire.id, closesAt: questionnaire.closesAt })
    .from(questionnaire)
    .where(eq(questionnaire.id, questionnaireId));
}

export async function withLockedQuestionnaire<Outcome>(
  executor: Executor,
  questionnaireId: string,
  work: (tx: Transaction, locked: LockedQuestionnaire) => Promise<Outcome>,
): Promise<Outcome | QuestionnaireNotFound> {
  return executor.transaction(async (tx): Promise<Outcome | QuestionnaireNotFound> => {
    const locked = await lockedRow(selectQuestionnaire(tx, questionnaireId));
    if (locked === undefined) {
      return QUESTIONNAIRE_NOT_FOUND;
    }
    return work(tx, locked);
  });
}

export async function questionnaireExists(executor: Executor, questionnaireId: string): Promise<boolean> {
  return rowExists(selectQuestionnaire(executor, questionnaireId));
}
