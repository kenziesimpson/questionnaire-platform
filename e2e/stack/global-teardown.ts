import { downComposeStack } from "./compose-stack.ts";
import { STACK_ENV } from "./stack-endpoints.ts";

export default async function globalTeardown(): Promise<void> {
  const ownedProject = process.env[STACK_ENV.ownedComposeProject];
  if (ownedProject === undefined) return;
  console.log(`[e2e] Taking down stack ${ownedProject}…`);
  await downComposeStack(ownedProject);
}
