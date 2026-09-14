import { PublishedDefinition } from "@qp/shared";
import { eq } from "drizzle-orm";
import { jsonb, uuid } from "drizzle-orm/pg-core";
import { Value } from "typebox/value";
import type { Executor } from "../../db/client.js";
import { definitionSchema } from "../../db/schema.js";

export const publishedQuestionnaireVersion = definitionSchema
  .view("published_questionnaire_version", {
    id: uuid("id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
  })
  .existing();

export function publishedDefinitionOf(stored: unknown): PublishedDefinition {
  if (Value.Check(PublishedDefinition, stored)) {
    return stored;
  }
  throw new Error("stored snapshot is not a PublishedDefinition in a supported format");
}

export class PublishedDefinitions {
  readonly #byVersionId = new Map<string, PublishedDefinition>();

  async pinned(executor: Executor, questionnaireVersionId: string): Promise<PublishedDefinition> {
    const cached = this.#byVersionId.get(questionnaireVersionId);
    if (cached !== undefined) {
      return cached;
    }
    const [row] = await executor
      .select({ snapshot: publishedQuestionnaireVersion.snapshot })
      .from(publishedQuestionnaireVersion)
      .where(eq(publishedQuestionnaireVersion.id, questionnaireVersionId));
    if (row === undefined) {
      throw new Error("a session pins a questionnaire version that is not published");
    }
    const definition = publishedDefinitionOf(row.snapshot);
    this.#byVersionId.set(questionnaireVersionId, definition);
    return definition;
  }
}
