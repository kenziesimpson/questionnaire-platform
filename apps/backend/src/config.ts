function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const DATABASE_ROLES = ["owner", "definition", "execution", "reporting"] as const;
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

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
