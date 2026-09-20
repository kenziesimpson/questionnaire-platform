import { DATABASE_POOLS, LOG_LEVELS, type LogLevel } from "@qp/telemetry";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const POOL_ROLES = DATABASE_POOLS;
export type PoolRole = (typeof POOL_ROLES)[number];

export const DATABASE_ROLES = ["owner", ...POOL_ROLES] as const;
export type DatabaseRole = (typeof DATABASE_ROLES)[number];

const databaseUrlVariable: Record<DatabaseRole, string> = {
  owner: "DATABASE_URL_OWNER",
  definition: "DATABASE_URL_DEFINITION",
  execution: "DATABASE_URL_EXECUTION",
  reporting: "DATABASE_URL_REPORTING",
};

export function databaseUrl(role: DatabaseRole): string {
  return required(databaseUrlVariable[role]);
}

function logLevelFrom(value: string | undefined): LogLevel {
  const level = LOG_LEVELS.find((known) => known === (value ?? "info"));
  if (level === undefined) {
    throw new Error(`Unsupported LOG_LEVEL "${value}": expected one of ${LOG_LEVELS.join(", ")}`);
  }
  return level;
}

function presentOrUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: logLevelFrom(process.env.LOG_LEVEL),
  telemetry: {
    serviceName: presentOrUndefined(process.env.OTEL_SERVICE_NAME) ?? "qp-backend",
    otlpEndpoint: presentOrUndefined(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    prettyLogs: nodeEnv === "development",
  },
} as const;
