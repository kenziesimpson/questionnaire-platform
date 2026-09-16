export interface StackEndpoints {
  readonly baseUrl: string;
  readonly databaseUrl: string;
}

export const STACK_ENV = {
  baseUrl: "E2E_BASE_URL",
  databaseUrl: "E2E_DATABASE_URL",
  keepStack: "E2E_KEEP_STACK",
  ownedComposeProject: "E2E_OWNED_COMPOSE_PROJECT",
  runId: "E2E_RUN_ID",
} as const;

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

export function stackEndpointsFromEnvironment(environment: NodeJS.ProcessEnv = process.env): StackEndpoints | undefined {
  const baseUrl = nonEmpty(environment[STACK_ENV.baseUrl]);
  const databaseUrl = nonEmpty(environment[STACK_ENV.databaseUrl]);
  if (baseUrl === undefined && databaseUrl === undefined) return undefined;
  if (baseUrl === undefined || databaseUrl === undefined) {
    throw new Error(
      `Set both ${STACK_ENV.baseUrl} and ${STACK_ENV.databaseUrl} to target a running stack, or neither to let the suite start one.`,
    );
  }
  return { baseUrl: withoutTrailingSlash(baseUrl), databaseUrl };
}

export function requireStackEndpoints(): StackEndpoints {
  const endpoints = stackEndpointsFromEnvironment();
  if (endpoints === undefined) {
    throw new Error(
      `No stack to test against. Run the suite with \`npm run test -w e2e\` so global setup starts one, or set ${STACK_ENV.baseUrl} and ${STACK_ENV.databaseUrl}.`,
    );
  }
  return endpoints;
}

export function publishStackEndpoints(endpoints: StackEndpoints): void {
  process.env[STACK_ENV.baseUrl] = endpoints.baseUrl;
  process.env[STACK_ENV.databaseUrl] = endpoints.databaseUrl;
}

export function shellExportsFor(endpoints: StackEndpoints): string {
  return [`export ${STACK_ENV.baseUrl}=${endpoints.baseUrl}`, `export ${STACK_ENV.databaseUrl}=${endpoints.databaseUrl}`].join("\n");
}
