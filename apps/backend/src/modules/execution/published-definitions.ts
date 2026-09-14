import { readStoredDefinition, type PublishedDefinition } from "@qp/shared";
import { eq } from "drizzle-orm";
import { integer, jsonb, uuid } from "drizzle-orm/pg-core";
import type { Executor } from "../../db/client.js";
import { definitionSchema } from "../../db/schema.js";

export const publishedQuestionnaireVersion = definitionSchema
  .view("published_questionnaire_version", {
    id: uuid("id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    formatVersion: integer("format_version").notNull(),
  })
  .existing();

export class PublishedDefinitions {
  readonly #byVersionId = new Map<string, PublishedDefinition>();

  async pinned(executor: Executor, questionnaireVersionId: string): Promise<PublishedDefinition> {
    const cached = this.#byVersionId.get(questionnaireVersionId);
    if (cached !== undefined) {
      return cached;
    }
    const [row] = await executor
      .select({ snapshot: publishedQuestionnaireVersion.snapshot, formatVersion: publishedQuestionnaireVersion.formatVersion })
      .from(publishedQuestionnaireVersion)
      .where(eq(publishedQuestionnaireVersion.id, questionnaireVersionId));
    if (row === undefined) {
      throw new Error("a session pins a questionnaire version that is not published");
    }
    const definition = readStoredDefinition(row.snapshot, row.formatVersion);
    this.#byVersionId.set(questionnaireVersionId, definition);
    return definition;
  }
}
