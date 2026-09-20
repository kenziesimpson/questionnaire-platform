CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON pg_stat_statements, pg_stat_statements_info FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_stat_statements(boolean), pg_stat_statements_info() FROM PUBLIC;
GRANT SELECT ON pg_stat_statements, pg_stat_statements_info TO qp_monitor;
