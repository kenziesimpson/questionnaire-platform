import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: "admin",
      environment: "jsdom",
      include: ["_tests/**/*.test.{ts,tsx}"],
      setupFiles: ["./_tests/setup.ts"],
    },
  }),
);
