import { startComposeStack } from "./compose-stack.ts";
import { recordKeptStack } from "./kept-stacks.ts";
import { publishStackEndpoints, shellExportsFor, STACK_ENV, stackEndpointsFromEnvironment } from "./stack-endpoints.ts";
import { waitForStackReady } from "./stack-readiness.ts";

function keepStackRequested(): boolean {
  return process.env[STACK_ENV.keepStack] === "true";
}

export default async function globalSetup(): Promise<void> {
  const running = stackEndpointsFromEnvironment();
  if (running !== undefined) {
    await waitForStackReady(running);
    console.log(`[e2e] Reusing the running stack at ${running.baseUrl}`);
    return;
  }

  const keep = keepStackRequested();
  console.log("[e2e] Building images and starting docker-compose.yml through Testcontainers…");
  const stack = await startComposeStack({ reapWhenProcessExits: !keep });
  publishStackEndpoints(stack.endpoints);

  if (keep) {
    await recordKeptStack(stack);
    console.log(
      `[e2e] Stack ${stack.projectName} will stay up after this run. Point later runs at it with:\n${shellExportsFor(stack.endpoints)}\n[e2e] Take it down with: npm run stack:down -w e2e -- ${stack.projectName}`,
    );
  } else {
    process.env[STACK_ENV.ownedComposeProject] = stack.projectName;
    console.log(`[e2e] Stack ${stack.projectName} is ready at ${stack.endpoints.baseUrl}`);
  }
}
