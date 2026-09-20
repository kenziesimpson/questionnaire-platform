import { runningTelemetry, startTelemetry, type TelemetryHandle } from "@qp/telemetry/node";
import { config } from "./config.js";

export function startBackendTelemetry(autoInstrumentation: boolean): TelemetryHandle {
  return startTelemetry({
    serviceName: config.telemetry.serviceName,
    logLevel: config.logLevel,
    prettyLogs: config.telemetry.prettyLogs,
    otlpEndpoint: config.telemetry.otlpEndpoint,
    autoInstrumentation,
  });
}

export interface ProcessTelemetry {
  readonly handle: TelemetryHandle;
  readonly preloaded: boolean;
}

export function telemetryOfProcess(): ProcessTelemetry {
  const preloaded = runningTelemetry();
  return preloaded === undefined ? { handle: startBackendTelemetry(false), preloaded: false } : { handle: preloaded, preloaded: true };
}
