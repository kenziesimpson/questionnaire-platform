CREATE FUNCTION definition.reject_item_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.questionnaire_version_id <> OLD.questionnaire_version_id THEN
    RAISE EXCEPTION 'items cannot be reparented' USING ERRCODE = 'QP001';
  END IF;
  SELECT status INTO parent_status FROM definition.questionnaire_version
   WHERE id = COALESCE(NEW.questionnaire_version_id, OLD.questionnaire_version_id)
   FOR SHARE;
  IF parent_status = 'published' THEN
    RAISE EXCEPTION 'questionnaire version is published and immutable' USING ERRCODE = 'QP001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER item_immutable BEFORE INSERT OR UPDATE OR DELETE ON definition.questionnaire_item
  FOR EACH ROW EXECUTE FUNCTION definition.reject_item_mutation();
