import { readStoredDefinition, type PublishedDefinition } from "@qp/shared";
import { eq } from "drizzle-orm";
import { integer, jsonb, uuid } from "drizzle-orm/pg-core";
import { InvariantViolation } from "../../invariant.js";
import type { Executor } from "../client.js";
import { definitionSchema } from "../schema.js";

const publishedQuestionnaireVersion = definitionSchema
  .view("published_questionnaire_version", {
    id: uuid("id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    formatVersion: integer("format_version").notNull(),
  })
  .existing();

export class PublishedDefinitions {
  readonly #byVersionId = new Map<string, Promise<PublishedDefinition>>();

  pinned(executor: Executor, questionnaireVersionId: string): Promise<PublishedDefinition> {
    const cached = this.#byVersionId.get(questionnaireVersionId);
    if (cached !== undefined) {
      return cached;
    }
    const loading = this.#load(executor, questionnaireVersionId);
    this.#byVersionId.set(questionnaireVersionId, loading);
    loading.catch(() => {
      this.#byVersionId.delete(questionnaireVersionId);
    });
    return loading;
  }

  async #load(executor: Executor, questionnaireVersionId: string): Promise<PublishedDefinition> {
    const [row] = await executor
      .select({ snapshot: publishedQuestionnaireVersion.snapshot, formatVersion: publishedQuestionnaireVersion.formatVersion })
      .from(publishedQuestionnaireVersion)
      .where(eq(publishedQuestionnaireVersion.id, questionnaireVersionId));
    if (row === undefined) {
      throw InvariantViolation.of("session.pins-unpublished-version");
    }
    try {
      return readStoredDefinition(row.snapshot, row.formatVersion);
    } catch {
      throw InvariantViolation.of("stored-snapshot.unsupported-format");
    }
  }
}
