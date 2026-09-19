import { logger } from "@qp/telemetry";
import { buildApp } from "./app.js";
import { config, databaseUrl } from "./config.js";
import { openDatabase } from "./db/client.js";
import { requestLogger } from "./http/request-logger.js";
import { shutDown, shutDownOnSignals } from "./shutdown.js";
import { telemetryOfProcess } from "./telemetry.js";

const telemetry = telemetryOfProcess();
const log = logger("backend");

if (!telemetry.preloaded) {
  log.warn("started without the telemetry preload, so requests and queries are not traced");
}

const definition = openDatabase(databaseUrl("definition"));
const execution = openDatabase(databaseUrl("execution"));
const reporting = openDatabase(databaseUrl("reporting"));

const app = await buildApp({
  logger: requestLogger(config.logLevel),
  definition: { database: definition.db },
  execution: { database: execution.db },
  reporting: { reporting: reporting.db },
});

async function start() {
  try {
    await app.listen({ port: config.port, host: config.host });
    log.info("server listening");
  } catch (err) {
    log.error("server failed to start", undefined, err instanceof Error ? err : undefined);
    await shutDown(shutdownParts());
    process.exit(1);
  }
}

function shutdownParts() {
  return {
    closeApp: () => app.close(),
    telemetry: telemetry.handle,
    closePools: async () => {
      await Promise.all([definition.close(), execution.close(), reporting.close()]);
    },
  };
}

shutDownOnSignals(shutdownParts(), process);

void start();
