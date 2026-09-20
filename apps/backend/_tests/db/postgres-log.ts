import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, inject } from "vitest";
import type { TestDatabase } from "./harness.js";

const BARRIER_TIMEOUT_MS = 20_000;

const BARRIER_POLL_MS = 100;

export function postgresServerLogPath(): string | undefined {
  const path = inject("postgresServerLog");
  return path === "" ? undefined : path;
}

export function uniqueToken(): string {
  return `PGLOG_DIABETES_${randomUUID().replaceAll("-", "").toUpperCase()}`;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function readPostgresLogAfterBarrier(testDatabase: TestDatabase): Promise<string> {
  const path = postgresServerLogPath();
  if (path === undefined) {
    throw new Error("the Postgres server log is only captured for the Testcontainers container, not for TEST_DATABASE_URL");
  }
  const barrier = `qp-log-barrier-${randomUUID()}`;
  const owner = await testDatabase.connect("owner");
  await owner.query(`DO $$ BEGIN RAISE WARNING '${barrier}'; END $$`);
  const deadline = Date.now() + BARRIER_TIMEOUT_MS;
  for (;;) {
    const log = await readFile(path, "utf8");
    if (log.includes(barrier)) {
      return log;
    }
    if (Date.now() > deadline) {
      throw new Error(`the Postgres log did not show its barrier line within ${BARRIER_TIMEOUT_MS} ms`);
    }
    await pause(BARRIER_POLL_MS);
  }
}

export function linesMentioning(log: string, needle: string): string[] {
  return log.split("\n").filter((line) => line.includes(needle));
}

export async function failureOf(client: pg.Client, text: string, values: unknown[]): Promise<pg.DatabaseError> {
  const failure = await client.query(text, values).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure, `expected ${text} to fail with a database error, and it did not`).toBeInstanceOf(pg.DatabaseError);
  if (!(failure instanceof pg.DatabaseError)) {
    throw new Error(`expected ${text} to fail with a database error`);
  }
  return failure;
}
