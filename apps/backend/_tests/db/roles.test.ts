import { describe, expect, it } from "vitest";
import { useTestDatabase } from "./harness.js";

const testDatabase = useTestDatabase();

describe("db/init/01-roles.sh", () => {
  it("creates qp_owner, qp_definition and qp_execution as plain login roles and audit_owner without a login", async () => {
    const owner = await testDatabase.connect("owner");
    const roles = await owner.query(
      `SELECT rolname, rolsuper, rolcanlogin, rolcreaterole, rolbypassrls
         FROM pg_roles WHERE rolname IN ('qp_owner', 'qp_definition', 'qp_execution', 'audit_owner')
        ORDER BY rolname`,
    );
    expect(roles.rows).toEqual([
      { rolname: "audit_owner", rolsuper: false, rolcanlogin: false, rolcreaterole: false, rolbypassrls: false },
      { rolname: "qp_definition", rolsuper: false, rolcanlogin: true, rolcreaterole: false, rolbypassrls: false },
      { rolname: "qp_execution", rolsuper: false, rolcanlogin: true, rolcreaterole: false, rolbypassrls: false },
      { rolname: "qp_owner", rolsuper: false, rolcanlogin: true, rolcreaterole: false, rolbypassrls: false },
    ]);
  });

  it("makes qp_owner a member of audit_owner by explicit SET ROLE only, not inherited privilege", async () => {
    const owner = await testDatabase.connect("owner");
    const membership = await owner.query(
      `SELECT m.inherit_option, m.set_option FROM pg_auth_members m
        WHERE m.roleid = 'audit_owner'::regrole AND m.member = 'qp_owner'::regrole`,
    );
    expect(membership.rows).toEqual([{ inherit_option: false, set_option: true }]);
  });

  it("leaves qp_owner owning the database and every table the migrations created outside audit", async () => {
    const owner = await testDatabase.connect("owner");
    const database = await owner.query(`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()`);
    const foreignOwners = await owner.query(
      `SELECT c.oid::regclass::text AS relation, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('definition', 'execution', 'audit') AND c.relkind IN ('r', 'p')
          AND pg_get_userbyid(c.relowner) <> CASE WHEN n.nspname = 'audit' THEN 'audit_owner' ELSE 'qp_owner' END`,
    );
    expect(database.rows[0].owner).toBe("qp_owner");
    expect(foreignOwners.rows).toEqual([]);
  });
});
