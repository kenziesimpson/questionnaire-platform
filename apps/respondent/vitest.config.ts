import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "respondent",
    environment: "jsdom",
    include: ["_tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./_tests/setup.ts"],
  },
});
