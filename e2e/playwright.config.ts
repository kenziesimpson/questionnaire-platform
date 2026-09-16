import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { STACK_ENV } from "./stack/stack-endpoints.ts";

const onCi = process.env.CI === "true";

const slowMoMs = Number(process.env.E2E_SLOW_MO ?? 0);
const watching = slowMoMs > 0;
const watchingTimeoutMs = 10 * 60_000;

const runId = (process.env[STACK_ENV.runId] ??= `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(2).toString("hex")}`);

export default defineConfig({
  testDir: "./specs",
  outputDir: `test-results/${runId}`,
  globalSetup: "./stack/global-setup.ts",
  globalTeardown: "./stack/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: onCi,
  retries: onCi ? 1 : 0,
  workers: watching ? 1 : onCi ? 2 : undefined,
  timeout: watching ? watchingTimeoutMs : 30_000,
  expect: { timeout: watching ? 30_000 : 5_000 },
  reporter: [["list"], ["html", { outputFolder: `playwright-report/${runId}`, open: "never" }]],
  use: {
    headless: true,
    launchOptions: { slowMo: slowMoMs },
    trace: onCi ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
