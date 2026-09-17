import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject } from "vitest";
import { openDatabase, type Database, type DatabaseHandle } from "../../src/db/client.js";
import { ROLE_NAMES, TEMPLATE_DATABASE, withDatabase, withRole, type ApplicationRole } from "./server.js";

export interface TestDatabase {
  url(role: ApplicationRole): string;
  connect(role: ApplicationRole): Promise<pg.Client>;
  database(role: ApplicationRole): Database;
  readAuditEvents(): Promise<AuditEventRow[]>;
}

export interface AuditEventRow {
  readonly action: string;
  readonly questionnaire_id: string | null;
  readonly questionnaire_version_id: string | null;
  readonly version: number | null;
  readonly actor_id: string | null;
  readonly summary: Record<string, unknown> | null;
}

const TRUNCATE_DOMAIN_TABLES = `TRUNCATE
  definition.questionnaire, definition.questionnaire_version, definition.questionnaire_item,
  definition.version_question_index, definition.question, definition.question_version,
  definition.question_version_option, execution.session, execution.response`;

const CONNECTIONS_PER_POOL = 5;

function databaseNameForThisWorker(): string {
  const poolId = process.env.VITEST_POOL_ID;
  if (poolId === undefined || poolId === "") {
    throw new Error(
      "VITEST_POOL_ID is unset, so every worker would share one test database and clobber each other's rows between tests",
    );
  }
  return `qp_test_${poolId}`;
}

export function useTestDatabase(): TestDatabase {
  const server = inject("testDatabaseServer");
  const databaseName = databaseNameForThisWorker();
  const clientsOpenedByTheCurrentTest: pg.Client[] = [];
  const handles = new Map<ApplicationRole, DatabaseHandle>();
  let maintenance: pg.Client | undefined;

  const url = (role: ApplicationRole) =>
    withDatabase(withRole(server.adminUrl, ROLE_NAMES[role], server.passwords[role]), databaseName);

  const connect = async (role: ApplicationRole) => {
    const client = new pg.Client({ connectionString: url(role) });
    await client.connect();
    clientsOpenedByTheCurrentTest.push(client);
    return client;
  };

  const releaseClients = async () => {
    const open = clientsOpenedByTheCurrentTest.splice(0);
    await Promise.all(open.map((client) => client.end().catch(() => undefined)));
  };

  const database = (role: ApplicationRole) => {
    const existing = handles.get(role);
    if (existing !== undefined) {
      return existing.db;
    }
    const handle = openDatabase(url(role), { maxConnections: CONNECTIONS_PER_POOL });
    handles.set(role, handle);
    return handle.db;
  };

  const connectAsOwner = async () => {
    const client = new pg.Client({ connectionString: url("owner") });
    await client.connect();
    return client;
  };

  const withOwner = async <T>(work: (client: pg.Client) => Promise<T>): Promise<T> => {
    maintenance ??= await connectAsOwner();
    return work(maintenance);
  };

  const withAuditOwner = async <T>(work: (client: pg.Client) => Promise<T>): Promise<T> =>
    withOwner(async (owner) => {
      await owner.query("SET ROLE audit_owner");
      try {
        return await work(owner);
      } finally {
        await owner.query("RESET ROLE");
      }
    });

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: server.adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${databaseName} TEMPLATE ${TEMPLATE_DATABASE} OWNER qp_owner`);
    } finally {
      await admin.end();
    }
  });

  beforeEach(async () => {
    await withOwner((owner) => owner.query(TRUNCATE_DOMAIN_TABLES));
    await withAuditOwner((owner) => owner.query("TRUNCATE audit.event"));
  });

  afterEach(releaseClients);

  afterAll(async () => {
    await releaseClients();
    await Promise.all([...handles.values()].map((handle) => handle.close()));
    handles.clear();
    await maintenance?.end().catch(() => undefined);
    maintenance = undefined;
  });

  return {
    url,
    connect,
    database,
    readAuditEvents: () =>
      withAuditOwner(async (owner) => {
        const result = await owner.query<AuditEventRow>(
          `SELECT action, questionnaire_id, questionnaire_version_id, version, actor_id, summary
             FROM audit.event ORDER BY occurred_at, id`,
        );
        return result.rows;
      }),
  };
}

export function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function expectSqlState(operation: Promise<unknown>, sqlState: string): Promise<void> {
  const error = await operation.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error, `expected SQLSTATE ${sqlState}, but the statement succeeded`).toBeDefined();
  expect(sqlStateOf(error)).toBe(sqlState);
}

export const SQLSTATE = {
  immutable: "QP001",
  insufficientPrivilege: "42501",
  checkViolation: "23514",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  noPartitionForRow: "23514",
} as const;
