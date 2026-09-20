import { databaseUrl } from "../config.js";
import { openDatabase } from "./client.js";
import { applyMigrations } from "./migrations.js";
import { ensureResponsePartitions, RESPONSE_PARTITION_HORIZON_MONTHS } from "./partitions.js";

async function main(): Promise<void> {
  const ownerUrl = databaseUrl("owner");
  await applyMigrations(ownerUrl);
  console.log("Migrations complete.");

  const handle = openDatabase(ownerUrl);
  try {
    const created = await ensureResponsePartitions(handle.db, new Date(), RESPONSE_PARTITION_HORIZON_MONTHS);
    console.log(`Response partitions: ${created.length === 0 ? "none missing" : `created ${created.join(", ")}`}.`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
