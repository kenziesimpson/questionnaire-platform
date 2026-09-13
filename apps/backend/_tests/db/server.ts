export const TEMPLATE_DATABASE = "qp_test_template";

export type ApplicationRole = "owner" | "definition" | "execution";

export type RolePasswords = Readonly<Record<ApplicationRole, string>>;

export interface TestDatabaseServer {
  readonly adminUrl: string;
  readonly passwords: RolePasswords;
}

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseServer: TestDatabaseServer;
  }
}

export const ROLE_NAMES: Readonly<Record<ApplicationRole, string>> = {
  owner: "qp_owner",
  definition: "qp_definition",
  execution: "qp_execution",
};

export function withDatabase(connectionUrl: string, database: string): string {
  const url = new URL(connectionUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export function withRole(connectionUrl: string, user: string, password: string): string {
  const url = new URL(connectionUrl);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return url.toString();
}
