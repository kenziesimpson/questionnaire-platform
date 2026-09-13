CREATE FUNCTION definition.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'row is published and immutable' USING ERRCODE = 'QP001';
END $$;
--> statement-breakpoint
CREATE TRIGGER qv_immutable_update BEFORE UPDATE ON definition.questionnaire_version
  FOR EACH ROW WHEN (OLD.status = 'published') EXECUTE FUNCTION definition.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER qv_immutable_delete BEFORE DELETE ON definition.questionnaire_version
  FOR EACH ROW WHEN (OLD.status = 'published') EXECUTE FUNCTION definition.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER question_version_append_only BEFORE UPDATE OR DELETE ON definition.question_version
  FOR EACH ROW EXECUTE FUNCTION definition.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER question_version_option_append_only BEFORE UPDATE OR DELETE ON definition.question_version_option
  FOR EACH ROW EXECUTE FUNCTION definition.reject_mutation();
