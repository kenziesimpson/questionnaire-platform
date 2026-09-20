DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(DISTINCT question_id || ' version ' || version || ' option ' || option_id, ', ')
    INTO offending
    FROM definition.question_version_option
   WHERE freeform <> (option_id = 'other');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'question versions break the reserved other option id: %', offending
      USING ERRCODE = 'check_violation',
            HINT = 'Question versions are immutable, so 0015 cannot be applied to this database. See the backend README, Migrations that refuse existing data.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "definition"."question_version_option" DROP CONSTRAINT "freeform_is_other";--> statement-breakpoint
DROP INDEX "definition"."qvo_one_freeform";--> statement-breakpoint
ALTER TABLE "definition"."question_version_option" ADD CONSTRAINT "freeform_exactly_when_other" CHECK (freeform = (option_id = 'other'));
