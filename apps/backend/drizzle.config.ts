import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  schemaFilter: ["definition", "execution", "audit"],
  dbCredentials: {
    url: process.env.DATABASE_URL_OWNER ?? "",
  },
});
