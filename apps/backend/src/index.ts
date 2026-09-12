import Fastify from "fastify";
import { config } from "./config.js";

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      config.nodeEnv === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// Liveness/readiness probe. Extend with a DB ping once the definition/
// execution modules exist (design-doc §14 observability).
app.get("/health", async () => ({ status: "ok" }));

// TODO: register the questionnaire-definition module (authoring, publishing)
// and the questionnaire-execution module (sessions, responses) here as
// separate Fastify plugins once the API boundary (design-doc §9) is decided —
// keeping them as distinct plugins is what makes that boundary visible.

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
