import { databaseUrl } from "../config.js";
import { openDatabase } from "./client.js";
import { seedDemoQuestionnaire } from "./demo-questionnaire.js";

async function main(): Promise<void> {
  const handle = openDatabase(databaseUrl("definition"));
  try {
    const outcome = await seedDemoQuestionnaire(handle.db);
    console.log(`Seed: demo questionnaire ${outcome}.`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
