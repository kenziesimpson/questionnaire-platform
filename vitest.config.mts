import { defineConfig } from "vitest/config";

// One command for every suite ([[8-testing]] §5.1). Each workspace is its own project with its
// own environment; `tests/` holds checks on repo-level configuration such as the lint boundaries.
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      { test: { name: "repo", include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30000 } },
    ],
  },
});
