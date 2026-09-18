ALTER TABLE "definition"."question_version_option" DROP CONSTRAINT "freeform_is_other";--> statement-breakpoint
DROP INDEX "definition"."qvo_one_freeform";--> statement-breakpoint
ALTER TABLE "definition"."question_version_option" ADD CONSTRAINT "freeform_exactly_when_other" CHECK (freeform = (option_id = 'other'));