import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DockerComposeEnvironment, getContainerRuntimeClient, type StartedTestContainer } from "testcontainers";
import type { StackEndpoints } from "./stack-endpoints.ts";
import { waitForStackReady } from "./stack-readiness.ts";

const runFile = promisify(execFile);

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const PRODUCTION_COMPOSE_FILE = "docker-compose.yml";

export const COMPOSE_PROJECT_PREFIX = "qp-e2e-";

export const COMPOSE_SUPERUSER = {
  user: "questionnaire",
  password: "questionnaire",
  database: "questionnaire_platform",
} as const;

const FRONTEND_CONTAINER = "frontend-1";
const FRONTEND_CONTAINER_PORT = 80;
const DATABASE_CONTAINER = "db-1";
const DATABASE_CONTAINER_PORT = 5432;
const EPHEMERAL_HOST_PORT = "0";

export interface ComposeStack {
  readonly projectName: string;
  readonly endpoints: StackEndpoints;
}

export interface StartComposeStackOptions {
  readonly projectName?: string;
  readonly reapWhenProcessExits: boolean;
}

export function newComposeProjectName(): string {
  return `${COMPOSE_PROJECT_PREFIX}${randomBytes(4).toString("hex")}`;
}

function loopbackHost(host: string): string {
  return host === "localhost" ? "127.0.0.1" : host;
}

function frontendUrl(frontend: StartedTestContainer): string {
  return `http://${loopbackHost(frontend.getHost())}:${frontend.getMappedPort(FRONTEND_CONTAINER_PORT)}`;
}

function superuserDatabaseUrl(database: StartedTestContainer): string {
  const { user, password, database: name } = COMPOSE_SUPERUSER;
  const host = loopbackHost(database.getHost());
  return `postgres://${user}:${password}@${host}:${database.getMappedPort(DATABASE_CONTAINER_PORT)}/${name}`;
}

export async function startComposeStack(options: StartComposeStackOptions): Promise<ComposeStack> {
  const projectName = options.projectName ?? newComposeProjectName();
  const environment = await new DockerComposeEnvironment(REPO_ROOT, PRODUCTION_COMPOSE_FILE)
    .withProjectName(projectName)
    .withBuild()
    .withAutoCleanup(options.reapWhenProcessExits)
    .withEnvironment({
      FRONTEND_PORT: EPHEMERAL_HOST_PORT,
      POSTGRES_PORT: EPHEMERAL_HOST_PORT,
      POSTGRES_USER: COMPOSE_SUPERUSER.user,
      POSTGRES_PASSWORD: COMPOSE_SUPERUSER.password,
      POSTGRES_DB: COMPOSE_SUPERUSER.database,
    })
    .up();

  const endpoints: StackEndpoints = {
    baseUrl: frontendUrl(environment.getContainer(FRONTEND_CONTAINER)),
    databaseUrl: superuserDatabaseUrl(environment.getContainer(DATABASE_CONTAINER)),
  };

  try {
    await waitForStackReady(endpoints);
  } catch (error) {
    await downComposeStack(projectName);
    throw error;
  }
  return { projectName, endpoints };
}

async function imagesBuiltFor(projectName: string): Promise<string[]> {
  const { stdout } = await runFile("docker", [
    "image",
    "ls",
    "--filter",
    `reference=${projectName}-*`,
    "--format",
    "{{.Repository}}:{{.Tag}}",
  ]);
  return stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

async function removeImagesBuiltFor(projectName: string): Promise<void> {
  const images = await imagesBuiltFor(projectName);
  if (images.length > 0) {
    await runFile("docker", ["image", "rm", ...images]);
  }
}

export async function downComposeStack(projectName: string): Promise<void> {
  if (!projectName.startsWith(COMPOSE_PROJECT_PREFIX)) {
    throw new Error(`Refusing to take down "${projectName}": the e2e harness only manages projects named ${COMPOSE_PROJECT_PREFIX}*.`);
  }
  const client = await getContainerRuntimeClient();
  await client.compose.down(
    { filePath: REPO_ROOT, files: PRODUCTION_COMPOSE_FILE, projectName },
    { removeVolumes: true, timeout: 0 },
  );
  await removeImagesBuiltFor(projectName);
}
