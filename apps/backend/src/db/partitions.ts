import { sql } from "drizzle-orm";
import type { Executor } from "./client.js";

export const RESPONSE_PARTITION_HORIZON_MONTHS = 24;

export interface ResponsePartition {
  readonly name: string;
  readonly from: Date;
  readonly to: Date;
}

export function startOfUtcMonth(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
}

function addUtcMonths(monthStart: Date, months: number): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + months, 1));
}

export function responsePartitionFor(instant: Date): ResponsePartition {
  const from = startOfUtcMonth(instant);
  const month = String(from.getUTCMonth() + 1).padStart(2, "0");
  return { name: `response_${from.getUTCFullYear()}_${month}`, from, to: addUtcMonths(from, 1) };
}

export function responsePartitionsFrom(firstMonth: Date, months: number): ResponsePartition[] {
  const start = startOfUtcMonth(firstMonth);
  return Array.from({ length: months }, (_, offset) => responsePartitionFor(addUtcMonths(start, offset)));
}

export async function ensureResponsePartitions(
  executor: Executor,
  firstMonth: Date,
  months: number,
): Promise<string[]> {
  const created: string[] = [];
  for (const partition of responsePartitionsFrom(firstMonth, months)) {
    const existing = await executor.execute<{ exists: boolean }>(
      // eslint-disable-next-line no-restricted-syntax -- to_regclass is a catalog function the query builder cannot call
      sql`SELECT to_regclass(${`execution.${partition.name}`}) IS NOT NULL AS exists`,
    );
    if (existing.rows[0]?.exists) {
      continue;
    }
    /* eslint-disable no-restricted-syntax -- partition DDL: the query builder has no CREATE TABLE ... PARTITION OF, and partition bounds cannot be bound parameters, so they are literal UTC timestamps computed by this module */
    await executor.execute(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("execution")}.${sql.identifier(partition.name)}
          PARTITION OF execution.response
          FOR VALUES FROM (${sql.raw(`'${partition.from.toISOString()}'`)}) TO (${sql.raw(`'${partition.to.toISOString()}'`)})`,
    );
    /* eslint-enable no-restricted-syntax */
    created.push(partition.name);
  }
  return created;
}
