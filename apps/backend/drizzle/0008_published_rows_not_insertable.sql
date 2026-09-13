CREATE TRIGGER qv_immutable_insert BEFORE INSERT ON definition.questionnaire_version
  FOR EACH ROW WHEN (NEW.status = 'published') EXECUTE FUNCTION definition.reject_mutation();
