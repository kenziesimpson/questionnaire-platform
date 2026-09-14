import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

async function restrictedSyntax(code: string, filePath = "packages/shared/src/engine/example.ts") {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("double type assertions", () => {
  it.each([
    ["through unknown", `declare const a: string;\nexport const b = a as unknown as number;`],
    ["through any", `declare const a: string;\nexport const b = a as any as number;`],
    ["through an angle-bracket unknown", `declare const a: string;\nexport const b = (<unknown>a) as number;`],
  ])("warns on a cast %s", async (_, code) => {
    const messages = await restrictedSyntax(code);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(1);
  });

  it("warns in every workspace, including the backend and the React apps", async () => {
    const code = `declare const a: string;\nexport const b = a as unknown as number;`;

    expect(await restrictedSyntax(code, "apps/backend/src/modules/definition/routes/example.ts")).toHaveLength(1);
    expect(await restrictedSyntax(code, "apps/admin/src/example.tsx")).toHaveLength(1);
  });

  it.each([
    ["a single assertion", `declare const a: string | number;\nexport const b = a as string;`],
    ["widening to unknown alone", `declare const a: string;\nexport const b = a as unknown;`],
    ["a const assertion", `export const b = ["x"] as const;`],
  ])("allows %s", async (_, code) => {
    expect(await restrictedSyntax(code)).toEqual([]);
  });

  it("accepts a disable comment carrying a reason, and it counts as used", async () => {
    const code = `declare const a: string;\n// eslint-disable-next-line no-restricted-syntax -- the library's types are wrong\nexport const b = a as unknown as number;`;
    const [result] = await eslint.lintText(code, { filePath: "packages/shared/src/engine/example.ts" });

    expect(result?.messages ?? []).toEqual([]);
  });
});
