import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { config } from "../config.js";

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
