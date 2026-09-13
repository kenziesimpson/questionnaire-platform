GRANT CREATE ON SCHEMA audit TO audit_owner;
--> statement-breakpoint
ALTER TABLE audit.event OWNER TO audit_owner;
--> statement-breakpoint
ALTER SCHEMA audit OWNER TO audit_owner;
--> statement-breakpoint
SET LOCAL ROLE audit_owner;
--> statement-breakpoint
CREATE FUNCTION audit.record(p_action text, p_qid uuid, p_qvid uuid, p_version int,
                             p_actor_id text, p_summary jsonb, p_trace_id text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_temp AS $$
  INSERT INTO audit.event (action, questionnaire_id, questionnaire_version_id,
                           version, actor_id, summary, trace_id)
  VALUES (p_action, p_qid, p_qvid, p_version, p_actor_id, p_summary, p_trace_id)
  RETURNING id;
$$;
--> statement-breakpoint
REVOKE ALL ON audit.event FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA audit TO qp_definition;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit.record(text, uuid, uuid, int, text, jsonb, text) TO qp_definition;
--> statement-breakpoint
RESET ROLE;
