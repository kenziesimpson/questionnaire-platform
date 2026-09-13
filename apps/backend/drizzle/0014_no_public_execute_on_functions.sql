REVOKE EXECUTE ON FUNCTION definition.reject_mutation() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION definition.reject_item_mutation() FROM PUBLIC;
--> statement-breakpoint
SET LOCAL ROLE audit_owner;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION audit.record(text, uuid, uuid, int, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
RESET ROLE;
