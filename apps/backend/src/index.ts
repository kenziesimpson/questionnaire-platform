import { buildApp } from "./app.js";
import { config, databaseUrl } from "./config.js";
import { openDatabase } from "./db/client.js";

const definition = openDatabase(databaseUrl("definition"));
const execution = openDatabase(databaseUrl("execution"));
const reporting = openDatabase(databaseUrl("reporting"));

const app = await buildApp({
  logger: {
    level: config.logLevel,
    transport:
      config.nodeEnv === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  definition: { database: definition.db },
  execution: { database: execution.db },
  reporting: { reporting: reporting.db, snapshots: execution.db },
});

app.addHook("onClose", async () => {
  await Promise.all([definition.close(), execution.close(), reporting.close()]);
});

async function start() {
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}

start();
