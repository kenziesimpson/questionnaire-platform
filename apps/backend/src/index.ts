import { buildApp } from "./app.js";
import { config, databaseUrl } from "./config.js";
import { openDatabase } from "./db/client.js";

const execution = openDatabase(databaseUrl("execution"));

const app = await buildApp({
  logger: {
    level: config.logLevel,
    transport:
      config.nodeEnv === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  execution: { database: execution.db },
});

app.addHook("onClose", async () => {
  await execution.close();
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
