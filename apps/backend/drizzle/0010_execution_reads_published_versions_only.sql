CREATE VIEW definition.published_questionnaire_version WITH (security_barrier = true) AS
  SELECT id, questionnaire_id, version, title, snapshot, format_version, published_at
    FROM definition.questionnaire_version
   WHERE status = 'published';
--> statement-breakpoint
REVOKE ALL ON definition.published_questionnaire_version FROM PUBLIC, qp_definition;
--> statement-breakpoint
REVOKE SELECT ON definition.questionnaire_version FROM qp_execution;
--> statement-breakpoint
GRANT SELECT ON definition.published_questionnaire_version TO qp_execution;
