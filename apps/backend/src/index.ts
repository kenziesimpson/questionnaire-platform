import { logger } from "@qp/telemetry";
import { buildApp } from "./app.js";
import { config, databaseUrl } from "./config.js";
import { openDatabase } from "./db/client.js";
import { requestLogger } from "./http/request-logger.js";

const log = logger("backend");

const definition = openDatabase(databaseUrl("definition"));
const execution = openDatabase(databaseUrl("execution"));
const reporting = openDatabase(databaseUrl("reporting"));

const app = await buildApp({
  logger: requestLogger(config.logLevel),
  definition: { database: definition.db },
  execution: { database: execution.db },
  reporting: { reporting: reporting.db },
});

app.addHook("onClose", async () => {
  await Promise.all([definition.close(), execution.close(), reporting.close()]);
});

async function start() {
  try {
    await app.listen({ port: config.port, host: config.host });
    log.info("server listening");
  } catch (err) {
    log.error("server failed to start", undefined, err instanceof Error ? err : undefined);
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    log.info("shutting down", { signal });
    await app.close();
    process.exit(0);
  });
}

void start();
