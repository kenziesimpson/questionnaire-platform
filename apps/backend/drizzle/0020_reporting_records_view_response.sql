-- Reading a response's raw answers is audited (design doc Decisions Log #89, observability O14, O18).
-- qp_reporting keeps SELECT only on every relation and gains EXECUTE on audit.record, so the one write it
-- can make is an audit row, in the same transaction as the read. The action list gains view_response.
SET LOCAL ROLE audit_owner;
--> statement-breakpoint
ALTER TABLE audit.event DROP CONSTRAINT event_action_check;
--> statement-breakpoint
ALTER TABLE audit.event ADD CONSTRAINT event_action_check CHECK (action IN ('create_draft', 'edit_draft', 'publish', 'retire', 'reopen', 'archive_question', 'create_question_version', 'view_response'));
--> statement-breakpoint
GRANT USAGE ON SCHEMA audit TO qp_reporting;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit.record(text, uuid, uuid, int, text, jsonb, text) TO qp_reporting;
--> statement-breakpoint
RESET ROLE;
