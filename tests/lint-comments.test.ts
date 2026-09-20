import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function proseComments(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "local/no-prose-comments").map((m) => m.message);
}

describe("L5: no prose comments", () => {
  it.each([
    ["a line comment", `// A regular explanatory comment.\nexport const x = 1;`],
    ["a block comment", `/* A regular explanatory comment. */\nexport const x = 1;`],
    ["a JSDoc comment", `/**\n * Some rationale that belongs in docs/ instead.\n */\nexport const x = 1;`],
    ["a trailing inline comment", `export const x = 1; // trailing note`],
  ])("rejects %s in packages/shared", async (_, code) => {
    expect(await proseComments("packages/shared/src/engine.ts", code)).toHaveLength(1);
  });

  it("rejects a prose comment in packages/telemetry", async () => {
    const code = `// The single telemetry boundary.\nexport const x = 1;`;
    expect(await proseComments("packages/telemetry/src/index.ts", code)).toHaveLength(1);
  });

  it("rejects a prose comment inside a package's _tests directory", async () => {
    const code = `// Explains what this fixture is for.\nexport const fixture = 1;`;
    expect(await proseComments("packages/shared/_tests/engine/fixtures.ts", code)).toHaveLength(1);
  });

  it("reports one violation per comment", async () => {
    const code = `// First.\n// Second.\nexport const x = 1;`;
    expect(await proseComments("packages/shared/src/engine.ts", code)).toHaveLength(2);
  });

  it.each([
    ["eslint-disable-next-line", `// eslint-disable-next-line no-restricted-syntax -- a real reason\nexport const x = 1;`],
    ["eslint-disable-line", `export const x = 1; // eslint-disable-line no-console -- a real reason`],
    [
      "an eslint-disable/eslint-enable block",
      `/* eslint-disable no-restricted-syntax -- a real reason */\nexport const x = 1;\n/* eslint-enable no-restricted-syntax */`,
    ],
  ])("allows %s, an ESLint directive", async (_, code) => {
    expect(await proseComments("packages/shared/src/engine.ts", code)).toEqual([]);
  });

  it("allows @ts-expect-error with an em-dash reason", async () => {
    const code = `// @ts-expect-error — a genuine reason\nexport const x: number = "y" as unknown as number;`;
    expect(await proseComments("packages/shared/src/engine.ts", code)).toEqual([]);
  });

  it.each([
    ["no reason at all", `// @ts-expect-error\nexport const x = 1;`],
    ["a hyphen instead of an em-dash", `// @ts-expect-error - not the right dash\nexport const x = 1;`],
    ["an em-dash with no reason after it", `// @ts-expect-error —\nexport const x = 1;`],
  ])("still rejects @ts-expect-error with %s", async (_, code) => {
    expect(await proseComments("packages/shared/src/engine.ts", code)).toHaveLength(1);
  });

  it.each([
    ["apps/backend/src/server.ts"],
    ["apps/admin/src/api/client.ts"],
    ["packages/ui/src/primitives/dialog.tsx"],
  ])("rejects a prose comment in %s now that the rule is repo-wide", async (filePath) => {
    const code = `// A prose comment.\nexport const x = 1;`;
    expect(await proseComments(filePath, code)).toHaveLength(1);
  });

  it.each([["eslint.config.mjs"], ["vitest.config.mts"], ["apps/backend/vitest.config.ts"]])(
    "allows a prose comment anywhere in the config file %s, exempt file-wide like L20's default-export rule",
    async (filePath) => {
      const code = `// A config-file header comment.\nexport default {\n  // and one buried in the body too\n  plugins: [],\n};`;
      expect(await proseComments(filePath, code)).toEqual([]);
    },
  );

  it("rejects a comment that merely starts with the word eslint, rather than a real directive", async () => {
    const code = `// eslint-ish musings about this function\nexport const x = 1;`;
    expect(await proseComments("packages/shared/src/engine.ts", code)).toHaveLength(1);
  });
});
