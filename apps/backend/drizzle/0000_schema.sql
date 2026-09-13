CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "definition";
--> statement-breakpoint
CREATE SCHEMA "execution";
--> statement-breakpoint
CREATE TABLE "audit"."event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"questionnaire_id" uuid,
	"questionnaire_version_id" uuid,
	"version" integer,
	"summary" jsonb,
	"trace_id" text,
	CONSTRAINT "event_action_check" CHECK (action IN ('create_draft', 'edit_draft', 'publish', 'retire', 'reopen', 'archive_question', 'create_question_version'))
);
--> statement-breakpoint
CREATE TABLE "definition"."question" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "definition"."question_version" (
	"question_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"prompt" text NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_version_pkey" PRIMARY KEY("question_id","version"),
	CONSTRAINT "question_version_version_check" CHECK (version >= 1),
	CONSTRAINT "question_version_type_check" CHECK (type IN ('text', 'single_choice', 'multiple_choice', 'number', 'date'))
);
--> statement-breakpoint
CREATE TABLE "definition"."question_version_option" (
	"question_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"option_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"freeform" boolean DEFAULT false NOT NULL,
	CONSTRAINT "question_version_option_pkey" PRIMARY KEY("question_id","version","option_id"),
	CONSTRAINT "question_version_option_position_key" UNIQUE("question_id","version","position"),
	CONSTRAINT "freeform_is_other" CHECK (NOT freeform OR option_id = 'other')
);
--> statement-breakpoint
CREATE TABLE "definition"."questionnaire" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"closes_at" timestamp with time zone,
	"current_version_id" uuid,
	"current_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questionnaire_key_key" UNIQUE("key"),
	CONSTRAINT "current_version_pair" CHECK ((current_version_id IS NULL) = (current_version IS NULL))
);
--> statement-breakpoint
CREATE TABLE "definition"."questionnaire_item" (
	"questionnaire_version_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"position" integer NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"visible_when" jsonb,
	"question_id" uuid NOT NULL,
	"question_version" integer NOT NULL,
	CONSTRAINT "questionnaire_item_pkey" PRIMARY KEY("questionnaire_version_id","item_id"),
	CONSTRAINT "item_position_unique" UNIQUE("questionnaire_version_id","position") DEFERRABLE INITIALLY IMMEDIATE
);
--> statement-breakpoint
CREATE TABLE "definition"."questionnaire_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"questionnaire_id" uuid NOT NULL,
	"version" integer,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"snapshot" jsonb,
	"format_version" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "qv_addressable" UNIQUE("questionnaire_id","id","version"),
	CONSTRAINT "questionnaire_version_version_check" CHECK (version >= 1),
	CONSTRAINT "questionnaire_version_status_check" CHECK (status IN ('draft', 'published')),
	CONSTRAINT "version_state" CHECK ((status = 'draft' AND version IS NULL AND snapshot IS NULL AND format_version IS NULL AND published_at IS NULL) OR (status = 'published' AND version IS NOT NULL AND snapshot IS NOT NULL AND format_version IS NOT NULL AND published_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "execution"."response" (
	"id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"session_id" uuid NOT NULL,
	"questionnaire_version_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"question_id" uuid NOT NULL,
	"question_version" integer NOT NULL,
	"question_type" text NOT NULL,
	"text_value" text,
	"number_value" numeric,
	"number_unit" text,
	"date_value" date,
	"option_ids" text[],
	"other_text" text,
	CONSTRAINT "response_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "other_text_needs_other" CHECK (other_text IS NULL OR (option_ids IS NOT NULL AND 'other' = ANY(option_ids))),
	CONSTRAINT "number_unit_needs_value" CHECK (number_unit IS NULL OR number_value IS NOT NULL)
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "execution"."session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"questionnaire_id" uuid NOT NULL,
	"questionnaire_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"response_digest" "bytea",
	CONSTRAINT "session_status_check" CHECK (status IN ('in_progress', 'submitted')),
	CONSTRAINT "session_state" CHECK ((status = 'in_progress' AND submitted_at IS NULL AND response_digest IS NULL) OR (status = 'submitted' AND submitted_at IS NOT NULL AND response_digest IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "definition"."version_question_index" (
	"questionnaire_version_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_version" integer NOT NULL,
	CONSTRAINT "version_question_index_pkey" PRIMARY KEY("questionnaire_version_id","question_id","question_version")
);
--> statement-breakpoint
ALTER TABLE "definition"."question_version" ADD CONSTRAINT "question_version_question_fk" FOREIGN KEY ("question_id") REFERENCES "definition"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition"."question_version_option" ADD CONSTRAINT "question_version_option_question_version_fk" FOREIGN KEY ("question_id","version") REFERENCES "definition"."question_version"("question_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition"."questionnaire" ADD CONSTRAINT "questionnaire_current_version_fk" FOREIGN KEY ("id","current_version_id","current_version") REFERENCES "definition"."questionnaire_version"("questionnaire_id","id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition"."questionnaire_item" ADD CONSTRAINT "questionnaire_item_questionnaire_version_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "definition"."questionnaire_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition"."questionnaire_item" ADD CONSTRAINT "questionnaire_item_question_version_fk" FOREIGN KEY ("question_id","question_version") REFERENCES "definition"."question_version"("question_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition"."questionnaire_version" ADD CONSTRAINT "questionnaire_version_questionnaire_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "definition"."questionnaire"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution"."response" ADD CONSTRAINT "response_session_fk" FOREIGN KEY ("session_id") REFERENCES "execution"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution"."response" ADD CONSTRAINT "response_questionnaire_version_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "definition"."questionnaire_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution"."session" ADD CONSTRAINT "session_pinned_version_fk" FOREIGN KEY ("questionnaire_id","questionnaire_version_id","version") REFERENCES "definition"."questionnaire_version"("questionnaire_id","id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition"."version_question_index" ADD CONSTRAINT "version_question_index_questionnaire_version_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "definition"."questionnaire_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition"."version_question_index" ADD CONSTRAINT "version_question_index_question_version_fk" FOREIGN KEY ("question_id","question_version") REFERENCES "definition"."question_version"("question_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_by_questionnaire" ON "audit"."event" USING btree ("questionnaire_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "qvo_one_freeform" ON "definition"."question_version_option" USING btree ("question_id","version") WHERE freeform;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_one_draft" ON "definition"."questionnaire_version" USING btree ("questionnaire_id") WHERE status = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_version_number" ON "definition"."questionnaire_version" USING btree ("questionnaire_id","version");--> statement-breakpoint
CREATE INDEX "response_by_session" ON "execution"."response" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "response_by_question" ON "execution"."response" USING btree ("question_id","question_version");--> statement-breakpoint
CREATE INDEX "response_by_option" ON "execution"."response" USING gin ("option_ids");--> statement-breakpoint
CREATE INDEX "session_by_version" ON "execution"."session" USING btree ("questionnaire_version_id","started_at");--> statement-breakpoint
CREATE INDEX "session_in_progress" ON "execution"."session" USING btree ("questionnaire_id","last_activity_at") WHERE status = 'in_progress';--> statement-breakpoint
CREATE INDEX "vqi_reverse" ON "definition"."version_question_index" USING btree ("question_id","question_version");