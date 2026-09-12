/**
 * One-shot migration runner, invoked by the `migrate` compose service
 * (design-doc §13: "Migrations have a dedicated owner").
 *
 * Applies any SQL files under ./drizzle (generated via `npm run db:generate`,
 * i.e. `drizzle-kit generate`) to the database at DATABASE_URL, then exits.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { config } from "../config.js";

// Resolve relative to this file (apps/backend/{src,dist}/db/migrate.ts), not
// process.cwd() — the compose `migrate` service runs from the monorepo root
// (/app), not from apps/backend.
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool);

  console.log("Running migrations against", config.databaseUrl.replace(/:[^:@/]+@/, ":****@"));
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
