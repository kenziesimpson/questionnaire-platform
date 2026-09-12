/**
 * Centralized env-var config. Deployment (docker-compose / k8s) supplies these
 * as plain environment variables — see design-doc §13 ("Configuration: environment
 * variables only, with a committed .env.example. No secrets in images.").
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: required(
    "DATABASE_URL",
    "postgres://postgres:postgres@localhost:5432/questionnaire_platform",
  ),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
