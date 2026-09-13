GRANT USAGE ON SCHEMA definition TO qp_definition;
--> statement-breakpoint
GRANT USAGE ON SCHEMA definition, execution TO qp_execution;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA definition TO qp_definition;
--> statement-breakpoint
GRANT SELECT ON definition.questionnaire, definition.questionnaire_version,
                definition.version_question_index TO qp_execution;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON execution.session TO qp_execution;
--> statement-breakpoint
GRANT SELECT, INSERT ON execution.response TO qp_execution;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE qp_owner IN SCHEMA definition
  GRANT SELECT, INSERT, UPDATE ON TABLES TO qp_definition;
