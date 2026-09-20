SET LOCAL ROLE audit_owner;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit.record(p_action text, p_qid uuid, p_qvid uuid, p_version int,
                                        p_actor_id text, p_summary jsonb, p_trace_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF session_user = 'qp_reporting' AND p_action IS DISTINCT FROM 'view_response' THEN
    RAISE EXCEPTION 'qp_reporting may record view_response only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO audit.event (action, questionnaire_id, questionnaire_version_id,
                           version, actor_id, summary, trace_id)
  VALUES (p_action, p_qid, p_qvid, p_version, p_actor_id, p_summary, p_trace_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
RESET ROLE;
