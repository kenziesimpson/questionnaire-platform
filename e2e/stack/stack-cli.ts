import { downComposeStack, startComposeStack } from "./compose-stack.ts";
import { forgetKeptStack, listKeptStacks, recordKeptStack, type KeptStackRecord } from "./kept-stacks.ts";
import { shellExportsFor } from "./stack-endpoints.ts";

function describe(record: KeptStackRecord): string {
  return `${record.projectName} (started ${record.startedAt})\n${shellExportsFor(record.endpoints)}`;
}

async function up(): Promise<void> {
  console.log("Building images and starting docker-compose.yml through Testcontainers…");
  const stack = await startComposeStack({ reapWhenProcessExits: false });
  const record = await recordKeptStack(stack);
  console.log(`\nStack is up: ${describe(record)}\n\nRun specs against it by exporting the two variables above, then: npm run test:e2e -w e2e`);
  console.log(`Take it down with: npm run stack:down -w e2e -- ${stack.projectName}`);
}

async function list(): Promise<void> {
  const records = await listKeptStacks();
  console.log(records.length === 0 ? "No kept stacks." : records.map(describe).join("\n\n"));
}

async function projectToTakeDown(requested: string | undefined): Promise<string> {
  if (requested !== undefined) return requested;
  const records = await listKeptStacks();
  const [only, ...others] = records;
  if (only !== undefined && others.length === 0) return only.projectName;
  const known = records.map((record) => `  ${record.projectName}`).join("\n");
  throw new Error(
    records.length === 0
      ? "No kept stacks are recorded. Pass a project name: npm run stack:down -w e2e -- <project>"
      : `Several kept stacks are recorded; name the one to take down:\n${known}`,
  );
}

async function down(requested: string | undefined): Promise<void> {
  const projectName = await projectToTakeDown(requested);
  console.log(`Taking down ${projectName}…`);
  await downComposeStack(projectName);
  await forgetKeptStack(projectName);
  console.log(`${projectName} is down.`);
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, argument] = argv;
  if (command === "up") return up();
  if (command === "list") return list();
  if (command === "down") return down(argument);
  throw new Error("Usage: stack-cli.ts up | list | down [project]");
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
