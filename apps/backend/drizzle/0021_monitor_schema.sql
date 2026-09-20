CREATE SCHEMA monitor;
--> statement-breakpoint
GRANT USAGE ON SCHEMA monitor TO qp_monitor;
--> statement-breakpoint
CREATE FUNCTION monitor.response_partition_months_ahead(as_of timestamptz DEFAULT now())
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
  WITH RECURSIVE partitions AS (
    SELECT substring(pg_get_expr(child.relpartbound, child.oid) FROM 'FROM \(''([^'']+)''\)')::timestamptz AS lower_bound,
           substring(pg_get_expr(child.relpartbound, child.oid) FROM 'TO \(''([^'']+)''\)')::timestamptz AS upper_bound
      FROM pg_inherits inheritance
      JOIN pg_class child ON child.oid = inheritance.inhrelid
     WHERE inheritance.inhparent = 'execution.response'::regclass
  ), covered AS (
    SELECT p.upper_bound
      FROM partitions p
     WHERE p.lower_bound <= as_of AND as_of < p.upper_bound
    UNION ALL
    SELECT p.upper_bound
      FROM partitions p
      JOIN covered c ON p.lower_bound = c.upper_bound
  )
  SELECT greatest(count(*) - 1, 0)::integer FROM covered
$body$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION monitor.response_partition_months_ahead(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION monitor.response_partition_months_ahead(timestamptz) TO qp_monitor;
