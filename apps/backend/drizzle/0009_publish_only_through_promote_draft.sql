REVOKE UPDATE ON definition.questionnaire_version FROM qp_definition;
--> statement-breakpoint
GRANT UPDATE (title, draft_revision, updated_at) ON definition.questionnaire_version TO qp_definition;
--> statement-breakpoint
REVOKE UPDATE ON definition.questionnaire FROM qp_definition;
--> statement-breakpoint
GRANT UPDATE (key, name, closes_at) ON definition.questionnaire TO qp_definition;
--> statement-breakpoint
SET LOCAL ROLE audit_owner;
--> statement-breakpoint
GRANT USAGE ON SCHEMA audit TO qp_owner;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit.record(text, uuid, uuid, int, text, jsonb, text) TO qp_owner;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
CREATE FUNCTION definition.promote_draft(p_questionnaire_version_id uuid, p_snapshot jsonb, p_actor_id text,
                                         p_summary jsonb, p_trace_id text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = definition, pg_temp AS $$
DECLARE
  v_questionnaire_id uuid;
  v_status text;
  v_version int;
BEGIN
  SELECT questionnaire_id, status INTO v_questionnaire_id, v_status
    FROM definition.questionnaire_version WHERE id = p_questionnaire_version_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'questionnaire version does not exist' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'row is published and immutable' USING ERRCODE = 'QP001';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM definition.questionnaire_version WHERE questionnaire_id = v_questionnaire_id;

  IF p_snapshot->>'questionnaireId' IS DISTINCT FROM v_questionnaire_id::text
     OR p_snapshot->>'version' IS DISTINCT FROM v_version::text THEN
    RAISE EXCEPTION 'snapshot does not name this questionnaire and its next version' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    (SELECT (e.ordinality - 1)::int, e.item->>'itemId', e.item->'question'->>'questionId',
            (e.item->'question'->>'questionVersion')::int
       FROM jsonb_array_elements(p_snapshot->'items') WITH ORDINALITY AS e(item, ordinality)
     EXCEPT
     SELECT (row_number() OVER (ORDER BY i.position) - 1)::int, i.item_id, i.question_id::text, i.question_version
       FROM definition.questionnaire_item i WHERE i.questionnaire_version_id = p_questionnaire_version_id)
    UNION ALL
    (SELECT (row_number() OVER (ORDER BY i.position) - 1)::int, i.item_id, i.question_id::text, i.question_version
       FROM definition.questionnaire_item i WHERE i.questionnaire_version_id = p_questionnaire_version_id
     EXCEPT
     SELECT (e.ordinality - 1)::int, e.item->>'itemId', e.item->'question'->>'questionId',
            (e.item->'question'->>'questionVersion')::int
       FROM jsonb_array_elements(p_snapshot->'items') WITH ORDINALITY AS e(item, ordinality))
  ) THEN
    RAISE EXCEPTION 'snapshot items do not match the draft item rows' USING ERRCODE = '22023';
  END IF;

  INSERT INTO definition.version_question_index (questionnaire_version_id, question_id, question_version)
  SELECT DISTINCT p_questionnaire_version_id, i.question_id, i.question_version
    FROM definition.questionnaire_item i WHERE i.questionnaire_version_id = p_questionnaire_version_id;

  UPDATE definition.questionnaire_version
     SET status = 'published',
         version = v_version,
         snapshot = p_snapshot,
         format_version = (p_snapshot->>'formatVersion')::int,
         published_at = now()
   WHERE id = p_questionnaire_version_id AND status = 'draft';

  UPDATE definition.questionnaire
     SET current_version_id = p_questionnaire_version_id, current_version = v_version
   WHERE id = v_questionnaire_id;

  PERFORM audit.record('publish', v_questionnaire_id, p_questionnaire_version_id, v_version,
                       p_actor_id, p_summary, p_trace_id);

  RETURN v_version;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION definition.promote_draft(uuid, jsonb, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION definition.promote_draft(uuid, jsonb, text, jsonb, text) TO qp_definition;
