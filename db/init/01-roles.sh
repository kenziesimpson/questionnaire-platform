#!/bin/sh

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${QP_OWNER_PASSWORD:?QP_OWNER_PASSWORD must be set}"
: "${QP_DEFINITION_PASSWORD:?QP_DEFINITION_PASSWORD must be set}"
: "${QP_EXECUTION_PASSWORD:?QP_EXECUTION_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set database="$POSTGRES_DB" \
  --set qp_owner_password="$QP_OWNER_PASSWORD" \
  --set qp_definition_password="$QP_DEFINITION_PASSWORD" \
  --set qp_execution_password="$QP_EXECUTION_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE qp_owner LOGIN PASSWORD %L', :'qp_owner_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_owner') \gexec

SELECT format('CREATE ROLE qp_definition LOGIN PASSWORD %L', :'qp_definition_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_definition') \gexec

SELECT format('CREATE ROLE qp_execution LOGIN PASSWORD %L', :'qp_execution_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qp_execution') \gexec

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
