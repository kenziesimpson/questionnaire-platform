import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

const CLIENT = "apps/admin/src/api/client.ts";
const ROUTE_PATH_HELPER = "packages/shared/src/api/request.ts";

async function restrictedSyntax(code: string, filePath = CLIENT) {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("L6 — route paths are built only by the shared helper", () => {
  it.each([
    ["an admin client", CLIENT, 'export const p = "/q/:id".replace(/:([A-Za-z]+)/g, () => "x");'],
    ["a respondent client", "apps/respondent/src/api/request.ts", 'export const p = "/s/:sessionId".replace(/:(\\w+)/g, () => "x");'],
    ["an e2e fixture", "e2e/fixtures/api/example.ts", 'export const p = "/q/:id".replace(/:([A-Za-z]+)/g, () => "x");'],
    ["an e2e spec helper", "e2e/specs/tier-3/support/example.ts", 'export const p = "/q/:id".replace(/:([A-Za-z]+)/g, () => "x");'],
    ["the backend", "apps/backend/src/http/example.ts", 'export const p = "/q/:id".replace(/:([A-Za-z]+)/g, () => "x");'],
  ])("warns on a `:param` regex in %s", async (_, filePath, code) => {
    const messages = await restrictedSyntax(code, filePath);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.severity).toBe(1);
    expect(messages[0]?.message).toContain("routePath");
  });

  it("allows the regex inside routePath's own module", async () => {
    const code = 'export const p = "/q/:id".replace(/:([A-Za-z]+)/g, () => "x");';

    expect(await restrictedSyntax(code, ROUTE_PATH_HELPER)).toEqual([]);
  });

  it.each([
    ["a double assertion", "declare const a: string;\nexport const b = a as unknown as number;"],
    ["a default export", "export default { url: \"/q/:id\" };"],
    [
      "a hand-built problem guard",
      'import { ProblemDetails } from "@qp/shared";\nimport { Value } from "typebox/value";\nexport const ok = (b: unknown) => Value.Check(ProblemDetails, b);',
    ],
  ])("still warns on %s inside that module, so the exemption is only L6's", async (_, code) => {
    expect(await restrictedSyntax(code, ROUTE_PATH_HELPER)).toHaveLength(1);
  });

  it("catches the parameter regex however it is spelled, anchored or behind a path separator", async () => {
    expect(await restrictedSyntax('export const p = "/q/:id".replace(/:([A-Za-z]+)/g, () => "x");')).toHaveLength(1);
    expect(await restrictedSyntax('export const p = "/q/:id".replace(/\\/:(\\w+)/g, () => "x");')).toHaveLength(1);
  });

  it.each([
    ["a colon outside a capture group", 'export const p = "a:b".replace(/:\\w+/g, () => "y");'],
    ["a string holding a route path", 'export const url = "/questionnaires/:id/draft";'],
    ["a non-capturing group, whose `?:(` is not a parameter", "export const p = /(?:(a|b))/;"],
    ["the draft ETag pattern, whose `:(` follows a length quantifier", 'export const E = /^W\\/"([0-9a-f-]{36}):(0|[1-9][0-9]*)"$/i;'],
  ])("allows %s", async (_, code) => {
    expect(await restrictedSyntax(code)).toEqual([]);
  });

  it("does not see a pattern built from a string, which no-restricted-syntax cannot reach", async () => {
    expect(await restrictedSyntax('export const p = "x".replace(new RegExp("/:(\\\\w+)", "g"), "y");')).toEqual([]);
  });
});
