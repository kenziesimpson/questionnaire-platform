import { startTelemetry } from "@qp/telemetry/node";
import { config } from "./config.js";

startTelemetry({
  serviceName: config.telemetry.serviceName,
  logLevel: config.logLevel,
  prettyLogs: config.telemetry.prettyLogs,
  otlpEndpoint: config.telemetry.otlpEndpoint,
  autoInstrumentation: true,
});
