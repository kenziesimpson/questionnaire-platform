GRANT USAGE ON SCHEMA definition TO qp_reporting;
--> statement-breakpoint
GRANT SELECT ON definition.published_questionnaire_version TO qp_reporting;
--> statement-breakpoint
GRANT SELECT (id) ON definition.questionnaire TO qp_reporting;
