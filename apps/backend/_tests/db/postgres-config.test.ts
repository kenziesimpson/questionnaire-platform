import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useTestDatabase } from "./harness.js";
import { POSTGRES_SERVER_SETTINGS } from "./server.js";

const testDatabase = useTestDatabase();

const COMPOSE_FILE = fileURLToPath(new URL("../../../../docker-compose.yml", import.meta.url));

const SETTING_FLAG = /^\s+- ([a-z_.]+=\S+)\s*$/;

function composeDbSettings(): Record<string, string> {
  const compose = readFileSync(COMPOSE_FILE, "utf8");
  const start = compose.indexOf("\n  db:\n");
  const rest = compose.slice(start + 1);
  const nextService = rest.slice("  db:\n".length).search(/^ {2}\S/m);
  const block = nextService === -1 ? rest : rest.slice(0, "  db:\n".length + nextService);
  const flags = block.split("\n").flatMap((line) => SETTING_FLAG.exec(line)?.[1] ?? []);
  return Object.fromEntries(flags.map((flag) => [flag.slice(0, flag.indexOf("=")), flag.slice(flag.indexOf("=") + 1)]));
}

describe("the Postgres server settings that keep a value out of Postgres's own log and stats", () => {
  it("are the ones the compose db service starts postgres with", () => {
    expect(composeDbSettings()).toEqual(POSTGRES_SERVER_SETTINGS);
  });

  it("are in effect on the server the tests run against", async () => {
    const monitor = await testDatabase.connect("monitor");

    const effective = await monitor.query<{ name: string; value: string }>(
      `SELECT name, current_setting(name) AS value FROM unnest($1::text[]) AS name`,
      [Object.keys(POSTGRES_SERVER_SETTINGS)],
    );

    expect(Object.fromEntries(effective.rows.map((row) => [row.name, row.value]))).toEqual(POSTGRES_SERVER_SETTINGS);
  });

  it("leave auto_explain unloaded, so there is no plan log to carry a parameter", async () => {
    const monitor = await testDatabase.connect("monitor");

    const loaded = await monitor.query<{ value: string }>(`SELECT current_setting('shared_preload_libraries') AS value`);

    expect(loaded.rows[0]?.value).not.toContain("auto_explain");
  });

  it("include the pg_stat_statements extension in the database, created by the roles script", async () => {
    const owner = await testDatabase.connect("owner");

    const extension = await owner.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`);

    expect(extension.rows).toEqual([{ extname: "pg_stat_statements" }]);
  });
});
