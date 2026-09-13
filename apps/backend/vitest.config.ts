import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "backend",
    environment: "node",
    include: ["_tests/**/*.test.ts"],
    globalSetup: ["_tests/db/global-setup.ts"],
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
