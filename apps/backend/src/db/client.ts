import { watchPool, type PoolName } from "@qp/telemetry";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

const APPLICATION_NAME = "qp-backend";

export interface DatabaseOptions {
  readonly maxConnections?: number;
  readonly pool?: PoolName;
}

export interface DatabaseHandle {
  readonly pool: pg.Pool;
  readonly db: Database;
  close(): Promise<void>;
}

export function openDatabase(connectionString: string, options: DatabaseOptions = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections,
    application_name: options.pool === undefined ? undefined : `${APPLICATION_NAME}:${options.pool}`,
  });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const stopWatching =
    options.pool === undefined
      ? undefined
      : watchPool(options.pool, () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
  return {
    pool,
    db,
    close: () => {
      stopWatching?.();
      return pool.end();
    },
  };
}
