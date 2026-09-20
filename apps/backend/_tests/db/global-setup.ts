import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { applyMigrations } from "../../src/db/migrations.js";
import { POSTGRES_SERVER_SETTINGS, TEMPLATE_DATABASE, withDatabase, withRole, type RolePasswords, type TestDatabaseServer } from "./server.js";

const ROLES_SCRIPT = fileURLToPath(new URL("../../../../db/init/01-roles.sh", import.meta.url));
const POSTGRES_IMAGE = "postgres:16-alpine";

const containerPasswords: RolePasswords = {
  owner: "qp_owner_test",
  definition: "qp_definition_test",
  execution: "qp_execution_test",
  reporting: "qp_reporting_test",
  monitor: "qp_monitor_test",
};

function passwordsFromEnvironment(): RolePasswords {
  return {
    owner: process.env.QP_OWNER_PASSWORD ?? "qp_owner",
    definition: process.env.QP_DEFINITION_PASSWORD ?? "qp_definition",
    execution: process.env.QP_EXECUTION_PASSWORD ?? "qp_execution",
    reporting: process.env.QP_REPORTING_PASSWORD ?? "qp_reporting",
    monitor: process.env.QP_MONITOR_PASSWORD ?? "qp_monitor",
  };
}

async function startContainer(): Promise<{ server: TestDatabaseServer; stop: () => Promise<void> }> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(TEMPLATE_DATABASE)
    .withUsername("bootstrap")
    .withPassword("bootstrap")
    .withCommand(["postgres", ...Object.entries(POSTGRES_SERVER_SETTINGS).flatMap(([name, value]) => ["-c", `${name}=${value}`])])
    .withCopyFilesToContainer([{ source: ROLES_SCRIPT, target: "/qp-init/01-roles.sh" }])
    .start();
  const roles = await container.exec(["sh", "/qp-init/01-roles.sh"], {
    env: {
      QP_OWNER_PASSWORD: containerPasswords.owner,
      QP_DEFINITION_PASSWORD: containerPasswords.definition,
      QP_EXECUTION_PASSWORD: containerPasswords.execution,
      QP_REPORTING_PASSWORD: containerPasswords.reporting,
      QP_MONITOR_PASSWORD: containerPasswords.monitor,
    },
  });
  if (roles.exitCode !== 0) {
    await container.stop();
    throw new Error(`db/init/01-roles.sh failed:\n${roles.output}`);
  }
  const adminUrl = withDatabase(container.getConnectionUri(), "postgres");
  const server: TestDatabaseServer = { adminUrl, passwords: containerPasswords };
  await applyMigrations(withDatabase(withRole(adminUrl, "qp_owner", containerPasswords.owner), TEMPLATE_DATABASE));
  return { server, stop: async () => void (await container.stop()) };
}

async function useExistingInstance(adminUrl: string): Promise<TestDatabaseServer> {
  const passwords = passwordsFromEnvironment();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DATABASE} OWNER qp_owner`);
  } finally {
    await admin.end();
  }
  await applyMigrations(withDatabase(withRole(adminUrl, "qp_owner", passwords.owner), TEMPLATE_DATABASE));
  return { adminUrl, passwords };
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const existing = process.env.TEST_DATABASE_URL;
  if (existing !== undefined && existing !== "") {
    project.provide("testDatabaseServer", await useExistingInstance(existing));
    return undefined;
  }
  const started = await startContainer();
  project.provide("testDatabaseServer", started.server);
  return started.stop;
}
