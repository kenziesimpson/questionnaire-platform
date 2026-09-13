import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  readonly pool: pg.Pool;
  readonly db: Database;
  close(): Promise<void>;
}

export function openDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { pool, db, close: () => pool.end() };
}
