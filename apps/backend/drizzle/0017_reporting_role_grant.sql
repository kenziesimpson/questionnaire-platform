-- qp_reporting: a third, dedicated read-only role for the admin responses browser (gh#18,
-- design doc Decisions Log #88). Scoped to exactly what that screen needs — SELECT on
-- execution.session and execution.response — not the full "third surface" §18 Open Question #8
-- anticipates (domain events, audited export stay unbuilt). qp_definition gains nothing here.
GRANT USAGE ON SCHEMA execution TO qp_reporting;
--> statement-breakpoint
GRANT SELECT ON execution.session, execution.response TO qp_reporting;
