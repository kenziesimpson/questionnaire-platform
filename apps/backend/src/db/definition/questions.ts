import type { QuestionInput } from "@qp/shared";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit.js";
import type { Executor, Transaction } from "../client.js";
import { question, questionVersion, questionVersionOption } from "../schema.js";
import { questionInputToColumns } from "./question-content.js";

export interface CreateQuestionCommand {
  readonly questionId?: string;
  readonly key: string | null;
  readonly content: QuestionInput;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export interface SavedQuestionVersion {
  readonly questionId: string;
  readonly questionVersion: number;
}

async function insertQuestionVersion(
  tx: Transaction,
  questionId: string,
  version: number,
  content: QuestionInput,
  createdBy: string | null,
  traceId: string | null,
): Promise<SavedQuestionVersion> {
  const columns = questionInputToColumns(content);
  await tx.insert(questionVersion).values({
    questionId,
    version,
    type: columns.type,
    prompt: columns.prompt,
    constraints: columns.constraints,
    createdBy,
  });
  if (columns.options.length > 0) {
    await tx.insert(questionVersionOption).values(
      columns.options.map((option, position) => ({
        questionId,
        version,
        optionId: option.optionId,
        label: option.label,
        position,
        freeform: option.freeform ?? false,
      })),
    );
  }
  await recordAudit(tx, {
    action: "create_question_version",
    questionnaireId: null,
    questionnaireVersionId: null,
    version: null,
    actorId: createdBy,
    summary: { questionId, questionVersion: version },
    traceId,
  });
  return { questionId, questionVersion: version };
}

export async function createQuestion(executor: Executor, command: CreateQuestionCommand): Promise<SavedQuestionVersion> {
  return executor.transaction(async (tx) => {
    const questionId = command.questionId ?? uuidv7();
    await tx.insert(question).values({ id: questionId, key: command.key });
    return insertQuestionVersion(tx, questionId, 1, command.content, command.createdBy, command.traceId);
  });
}

export interface AppendQuestionVersionCommand {
  readonly questionId: string;
  readonly content: QuestionInput;
  readonly createdBy: string | null;
  readonly traceId: string | null;
}

export type AppendQuestionVersionOutcome =
  | ({ readonly outcome: "saved" } & SavedQuestionVersion)
  | { readonly outcome: "not-found" };

export async function appendQuestionVersion(
  executor: Executor,
  command: AppendQuestionVersionCommand,
): Promise<AppendQuestionVersionOutcome> {
  return executor.transaction(async (tx) => {
    const locked = await tx
      .select({ id: question.id })
      .from(question)
      .where(eq(question.id, command.questionId))
      .for("update");
    if (locked.length === 0) {
      return { outcome: "not-found" };
    }
    const [latest] = await tx
      .select({ next: sql<number>`coalesce(max(${questionVersion.version}), 0) + 1` })
      .from(questionVersion)
      .where(eq(questionVersion.questionId, command.questionId));
    const saved = await insertQuestionVersion(
      tx,
      command.questionId,
      Number(latest?.next ?? 1),
      command.content,
      command.createdBy,
      command.traceId,
    );
    return { outcome: "saved", ...saved };
  });
}
