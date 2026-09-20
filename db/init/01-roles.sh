#!/bin/sh

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${QP_OWNER_PASSWORD:?QP_OWNER_PASSWORD must be set}"
: "${QP_DEFINITION_PASSWORD:?QP_DEFINITION_PASSWORD must be set}"
: "${QP_EXECUTION_PASSWORD:?QP_EXECUTION_PASSWORD must be set}"
: "${QP_REPORTING_PASSWORD:?QP_REPORTING_PASSWORD must be set}"
: "${QP_MONITOR_PASSWORD:?QP_MONITOR_PASSWORD must be set}"

for password in "$QP_OWNER_PASSWORD" "$QP_DEFINITION_PASSWORD" "$QP_EXECUTION_PASSWORD" "$QP_REPORTING_PASSWORD" "$QP_MONITOR_PASSWORD"; do
  case "$password" in
    *[!A-Za-z0-9._~-]*)
      echo "01-roles.sh: role passwords are interpolated into connection URLs and may contain only A-Z a-z 0-9 . _ ~ -" >&2
      exit 1
      ;;
  esac
done

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set database="$POSTGRES_DB" \
  --set qp_owner_password="$QP_OWNER_PASSWORD" \
  --set qp_definition_password="$QP_DEFINITION_PASSWORD" \
  --set qp_execution_password="$QP_EXECUTION_PASSWORD" \
  --set qp_reporting_password="$QP_REPORTING_PASSWORD" \
  --set qp_monitor_password="$QP_MONITOR_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE qp_owner LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_owner') \gexec
SELECT format('ALTER ROLE qp_owner PASSWORD %L', :'qp_owner_password') \gexec

SELECT 'CREATE ROLE qp_definition LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_definition') \gexec
SELECT format('ALTER ROLE qp_definition PASSWORD %L', :'qp_definition_password') \gexec

SELECT 'CREATE ROLE qp_execution LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_execution') \gexec
SELECT format('ALTER ROLE qp_execution PASSWORD %L', :'qp_execution_password') \gexec

SELECT 'CREATE ROLE qp_reporting LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_reporting') \gexec
SELECT format('ALTER ROLE qp_reporting PASSWORD %L', :'qp_reporting_password') \gexec

SELECT 'CREATE ROLE qp_monitor LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_monitor') \gexec
SELECT format('ALTER ROLE qp_monitor PASSWORD %L', :'qp_monitor_password') \gexec

SELECT 'GRANT pg_monitor TO qp_monitor'
 WHERE NOT EXISTS (
   SELECT FROM pg_auth_members m
     JOIN pg_roles granted ON granted.oid = m.roleid
     JOIN pg_roles member ON member.oid = m.member
    WHERE granted.rolname = 'pg_monitor' AND member.rolname = 'qp_monitor'
 ) \gexec

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT 'CREATE ROLE audit_owner NOLOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_owner') \gexec

SELECT format('ALTER DATABASE %I OWNER TO qp_owner', :'database') \gexec

SELECT 'GRANT audit_owner TO qp_owner WITH INHERIT FALSE'
 WHERE NOT EXISTS (
   SELECT FROM pg_auth_members m
     JOIN pg_roles granted ON granted.oid = m.roleid
     JOIN pg_roles member ON member.oid = m.member
    WHERE granted.rolname = 'audit_owner' AND member.rolname = 'qp_owner'
 ) \gexec
SQL
