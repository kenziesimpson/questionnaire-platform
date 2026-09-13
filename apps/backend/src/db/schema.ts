import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const timestamptz = () => timestamp({ withTimezone: true });

export const definitionSchema = pgSchema("definition");
export const executionSchema = pgSchema("execution");
export const auditSchema = pgSchema("audit");

export const questionnaire = definitionSchema.table(
  "questionnaire",
  {
    id: uuid().primaryKey(),
    key: text().unique("questionnaire_key_key"),
    name: text().notNull(),
    closesAt: timestamptz(),
    currentVersionId: uuid(),
    currentVersion: integer(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    check("current_version_pair", sql`(current_version_id IS NULL) = (current_version IS NULL)`),
    foreignKey({
      name: "questionnaire_current_version_fk",
      columns: [t.id, t.currentVersionId, t.currentVersion],
      foreignColumns: [
        questionnaireVersion.questionnaireId,
        questionnaireVersion.id,
        questionnaireVersion.version,
      ],
    }),
  ],
);

export const questionnaireVersion = definitionSchema.table(
  "questionnaire_version",
  {
    id: uuid().primaryKey(),
    questionnaireId: uuid().notNull(),
    version: integer(),
    status: text({ enum: ["draft", "published"] }).notNull(),
    title: text().notNull(),
    snapshot: jsonb(),
    formatVersion: integer(),
    createdBy: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    draftRevision: integer().notNull().default(0),
    publishedAt: timestamptz(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "questionnaire_version_questionnaire_fk",
      columns: [t.questionnaireId],
      foreignColumns: [questionnaire.id],
    }),
    check("questionnaire_version_version_check", sql`version >= 1`),
    check("questionnaire_version_status_check", sql`status IN ('draft', 'published')`),
    check(
      "version_state",
      sql`(status = 'draft' AND version IS NULL AND snapshot IS NULL AND format_version IS NULL AND published_at IS NULL) OR (status = 'published' AND version IS NOT NULL AND snapshot IS NOT NULL AND format_version IS NOT NULL AND published_at IS NOT NULL)`,
    ),
    unique("qv_addressable").on(t.questionnaireId, t.id, t.version),
    uniqueIndex("questionnaire_one_draft").on(t.questionnaireId).where(sql`status = 'draft'`),
    uniqueIndex("questionnaire_version_number").on(t.questionnaireId, t.version),
  ],
);

export const question = definitionSchema.table("question", {
  id: uuid().primaryKey(),
  key: text().unique("question_key_key"),
  archivedAt: timestamptz(),
  createdAt: timestamptz().notNull().defaultNow(),
});

export const RESPONSE_TYPE_VALUES = ["text", "single_choice", "multiple_choice", "number", "date"] as const;

export const questionVersion = definitionSchema.table(
  "question_version",
  {
    questionId: uuid().notNull(),
    version: integer().notNull(),
    type: text({ enum: RESPONSE_TYPE_VALUES }).notNull(),
    prompt: text().notNull(),
    constraints: jsonb().$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdBy: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "question_version_pkey", columns: [t.questionId, t.version] }),
    foreignKey({ name: "question_version_question_fk", columns: [t.questionId], foreignColumns: [question.id] }),
    check("question_version_version_check", sql`version >= 1`),
    check(
      "question_version_type_check",
      sql`type IN ('text', 'single_choice', 'multiple_choice', 'number', 'date')`,
    ),
  ],
);

export const questionVersionOption = definitionSchema.table(
  "question_version_option",
  {
    questionId: uuid().notNull(),
    version: integer().notNull(),
    optionId: text().notNull(),
    label: text().notNull(),
    position: integer().notNull(),
    freeform: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ name: "question_version_option_pkey", columns: [t.questionId, t.version, t.optionId] }),
    foreignKey({
      name: "question_version_option_question_version_fk",
      columns: [t.questionId, t.version],
      foreignColumns: [questionVersion.questionId, questionVersion.version],
    }),
    unique("question_version_option_position_key").on(t.questionId, t.version, t.position),
    check("freeform_is_other", sql`NOT freeform OR option_id = 'other'`),
    uniqueIndex("qvo_one_freeform").on(t.questionId, t.version).where(sql`freeform`),
  ],
);

export const questionnaireItem = definitionSchema.table(
  "questionnaire_item",
  {
    questionnaireVersionId: uuid().notNull(),
    itemId: text().notNull(),
    position: integer().notNull(),
    required: boolean().notNull().default(false),
    visibleWhen: jsonb(),
    questionId: uuid().notNull(),
    questionVersion: integer().notNull(),
  },
  (t) => [
    primaryKey({ name: "questionnaire_item_pkey", columns: [t.questionnaireVersionId, t.itemId] }),
    foreignKey({
      name: "questionnaire_item_questionnaire_version_fk",
      columns: [t.questionnaireVersionId],
      foreignColumns: [questionnaireVersion.id],
    }),
    foreignKey({
      name: "questionnaire_item_question_version_fk",
      columns: [t.questionId, t.questionVersion],
      foreignColumns: [questionVersion.questionId, questionVersion.version],
    }),
    unique("item_position_unique").on(t.questionnaireVersionId, t.position),
  ],
);

export const versionQuestionIndex = definitionSchema.table(
  "version_question_index",
  {
    questionnaireVersionId: uuid().notNull(),
    questionId: uuid().notNull(),
    questionVersion: integer().notNull(),
  },
  (t) => [
    primaryKey({
      name: "version_question_index_pkey",
      columns: [t.questionnaireVersionId, t.questionId, t.questionVersion],
    }),
    foreignKey({
      name: "version_question_index_questionnaire_version_fk",
      columns: [t.questionnaireVersionId],
      foreignColumns: [questionnaireVersion.id],
    }),
    foreignKey({
      name: "version_question_index_question_version_fk",
      columns: [t.questionId, t.questionVersion],
      foreignColumns: [questionVersion.questionId, questionVersion.version],
    }),
    index("vqi_reverse").on(t.questionId, t.questionVersion),
  ],
);

export const session = executionSchema.table(
  "session",
  {
    id: uuid().primaryKey(),
    questionnaireId: uuid().notNull(),
    questionnaireVersionId: uuid().notNull(),
    version: integer().notNull(),
    status: text({ enum: ["in_progress", "submitted"] }).notNull(),
    startedAt: timestamptz().notNull().defaultNow(),
    lastActivityAt: timestamptz().notNull().defaultNow(),
    submittedAt: timestamptz(),
    responseDigest: bytea(),
  },
  (t) => [
    foreignKey({
      name: "session_pinned_version_fk",
      columns: [t.questionnaireId, t.questionnaireVersionId, t.version],
      foreignColumns: [questionnaireVersion.questionnaireId, questionnaireVersion.id, questionnaireVersion.version],
    }),
    unique("session_pinned_version_key").on(t.id, t.questionnaireVersionId),
    check("session_status_check", sql`status IN ('in_progress', 'submitted')`),
    check(
      "session_state",
      sql`(status = 'in_progress' AND submitted_at IS NULL AND response_digest IS NULL) OR (status = 'submitted' AND submitted_at IS NOT NULL AND response_digest IS NOT NULL)`,
    ),
    index("session_by_version").on(t.questionnaireVersionId, t.startedAt),
    index("session_in_progress").on(t.questionnaireId, t.lastActivityAt).where(sql`status = 'in_progress'`),
  ],
);

export const response = executionSchema.table(
  "response",
  {
    id: uuid().notNull(),
    createdAt: timestamptz().notNull(),
    sessionId: uuid().notNull(),
    questionnaireVersionId: uuid().notNull(),
    itemId: text().notNull(),
    questionId: uuid().notNull(),
    questionVersion: integer().notNull(),
    questionType: text({ enum: RESPONSE_TYPE_VALUES }).notNull(),
    textValue: text(),
    numberValue: numeric({ mode: "string" }),
    numberUnit: text(),
    dateValue: date({ mode: "string" }),
    optionIds: text().array(),
    otherText: text(),
  },
  (t) => [
    primaryKey({ name: "response_pkey", columns: [t.id, t.createdAt] }),
    foreignKey({ name: "response_session_fk", columns: [t.sessionId], foreignColumns: [session.id] }),
    foreignKey({
      name: "response_questionnaire_version_fk",
      columns: [t.questionnaireVersionId],
      foreignColumns: [questionnaireVersion.id],
    }),
    foreignKey({
      name: "response_session_pinned_version_fk",
      columns: [t.sessionId, t.questionnaireVersionId],
      foreignColumns: [session.id, session.questionnaireVersionId],
    }),
    check("other_text_needs_other", sql`other_text IS NULL OR (option_ids IS NOT NULL AND 'other' = ANY(option_ids))`),
    check("number_unit_needs_value", sql`number_unit IS NULL OR number_value IS NOT NULL`),
    index("response_by_session").on(t.sessionId, t.createdAt),
    index("response_by_question").on(t.questionId, t.questionVersion),
    index("response_by_option").using("gin", t.optionIds),
  ],
);

export const AUDIT_ACTIONS = [
  "create_draft",
  "edit_draft",
  "publish",
  "retire",
  "reopen",
  "archive_question",
  "create_question_version",
] as const;

export const auditEvent = auditSchema.table(
  "event",
  {
    id: uuid().primaryKey().defaultRandom(),
    occurredAt: timestamptz().notNull().defaultNow(),
    actorType: text().notNull().default("system"),
    actorId: text(),
    action: text({ enum: AUDIT_ACTIONS }).notNull(),
    questionnaireId: uuid(),
    questionnaireVersionId: uuid(),
    version: integer(),
    summary: jsonb(),
    traceId: text(),
  },
  (t) => [
    check(
      "event_action_check",
      sql`action IN ('create_draft', 'edit_draft', 'publish', 'retire', 'reopen', 'archive_question', 'create_question_version')`,
    ),
    index("audit_by_questionnaire").on(t.questionnaireId, t.occurredAt.desc()),
  ],
);
