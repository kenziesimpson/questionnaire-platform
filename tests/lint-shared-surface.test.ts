import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedSyntax(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

const SHARED_ENTRY_POINT = "packages/shared/src/index.ts";
const VOCABULARY = "This name is shared vocabulary";
const UNNAMED_RE_EXPORT = "`export *`";

describe("L8 — entry points name their exports", () => {
  it.each([
    ["the shared entry point", SHARED_ENTRY_POINT, "./primitives.js"],
    ["the renderer's entry point", "packages/ui/src/questionnaire/index.ts", "./primitives"],
    ["packages/telemetry", "packages/telemetry/src/index.ts", "./primitives.js"],
    ["the shared domain, which is exempt from L9 only", "packages/shared/src/domain/question.ts", "./primitives.js"],
    ["an app", "apps/admin/src/api/index.ts", "./primitives"],
    ["the e2e fixtures' barrel", "e2e/fixtures/index.ts", "./primitives"],
  ])("warns on `export *` in %s", async (_, filePath, specifier) => {
    const messages = await restrictedSyntax(filePath, `export * from "${specifier}";`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(UNNAMED_RE_EXPORT);
  });

  it.each([
    ["a namespace re-export, which adds one named export", `export * as definitionApi from "./api/definition.js";`],
    ["a named re-export", `export { Uuid, strict } from "./primitives.js";`],
    ["a named type re-export", `export { type QuestionOf } from "./domain/question.js";`],
  ])("allows %s", async (_, code) => {
    expect(await restrictedSyntax(SHARED_ENTRY_POINT, code)).toEqual([]);
  });
});

describe("L9 — the shared vocabulary is declared once", () => {
  it.each([
    ["QuestionOf as a type alias in admin", "apps/admin/src/screens/version-preview/sample-answer-input.tsx", `type QuestionOf<T> = T;`],
    ["strict in the respondent's persistence seam", "apps/respondent/src/storage/partials.ts", `const strict = { additionalProperties: false } as const;`],
    ["OTHER_OPTION_ID in the renderer", "packages/ui/src/questionnaire/messages.ts", `export const OTHER_OPTION_ID = "other";`],
    ["optionIdsOf in admin", "apps/admin/src/screens/draft-editor/draft-item-messages.ts", `function optionIdsOf(): string[] { return []; }`],
    ["freeformOptionOf in the renderer", "packages/ui/src/questionnaire/controls/single-choice-control.tsx", `const freeformOptionOf = () => undefined;`],
    ["conditionsOf in admin", "apps/admin/src/screens/draft-editor/draft-changes.ts", `export function conditionsOf(): [] { return []; }`],
    ["referencedOptionIds in the engine, outside the shared domain", "packages/shared/src/engine/draft-validation.ts", `function referencedOptionIds(): [] { return []; }`],
    ["OPERATORS_BY_TYPE in admin", "apps/admin/src/screens/draft-editor/conditions.ts", `export const OPERATORS_BY_TYPE = {};`],
    ["isChoiceQuestion in the backend", "apps/backend/src/db/definition/question-content.ts", `const isChoiceQuestion = (): boolean => true;`],
    ["draftItemOf in a backend fixture", "apps/backend/_tests/db/execution/fixtures.ts", `function draftItemOf(): void {}`],
    ["draftForValidation in the backend", "apps/backend/src/db/definition/draft-contents.ts", `export function draftForValidation(): void {}`],
    ["questionInputOf in an e2e fixture", "e2e/fixtures/demo/demo-questionnaire.ts", `export function questionInputOf(): void {}`],
    ["strict in the shared API routes", "packages/shared/src/api/definition.ts", `const strict = { additionalProperties: false } as const;`],
    ["strict in a backend test", "apps/backend/_tests/http/routes.test.ts", `const strict = { additionalProperties: false } as const;`],
    ["QuestionOf in the shared package's own tests", "packages/shared/_tests/engine/fixtures.ts", `export type QuestionOf = string;`],
    ["strict in routePath's own module", "packages/shared/src/api/request.ts", `const strict = { additionalProperties: false } as const;`],
  ])("warns on declaring %s", async (_, filePath, code) => {
    const messages = await restrictedSyntax(filePath, code);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(VOCABULARY);
  });

  it.each([
    ["an import and a call", `import { conditionsOf } from "@qp/shared";\nexport const none = conditionsOf(null);`],
    ["a renamed import", `import { strict as closed } from "@qp/shared";\nexport const shape = closed;`],
    ["a look-alike name", `export const strictMode = true;\nexport function conditionsOfItem(): void {}\nexport type QuestionOfType = string;`],
    ["the name as an object property", `export const options = { strict: true, OTHER_OPTION_ID: "x" };`],
  ])("allows %s", async (_, code) => {
    expect(await restrictedSyntax("apps/admin/src/screens/draft-editor/conditions.ts", code)).toEqual([]);
  });

  it.each([
    ["strict in primitives.ts", "packages/shared/src/primitives.ts", `export const strict = { additionalProperties: false } as const;`],
    ["QuestionOf in the domain", "packages/shared/src/domain/question.ts", `export type QuestionOf<T> = T;`],
    ["conditionsOf in the domain", "packages/shared/src/domain/condition.ts", `export function conditionsOf(): [] { return []; }`],
    ["draftItemOf in the domain", "packages/shared/src/domain/draft.ts", `export function draftItemOf(): void {}`],
  ])("allows the one declaration of %s", async (_, filePath, code) => {
    expect(await restrictedSyntax(filePath, code)).toEqual([]);
  });

  it.each([
    ["a double assertion", `declare const a: string;\nexport const b = a as unknown as number;`],
    ["a default export", `export default {};`],
    ["a `:param` regex", `export const p = "/q/:id".replace(/:([A-Za-z]+)/g, () => "x");`],
    [
      "a hand-built problem guard",
      `import { ProblemDetails } from "./problems.js";\nimport { Value } from "typebox/value";\nexport const ok = (b: unknown) => Value.Check(ProblemDetails, b);`,
    ],
    ["building resource/not-found", `import { problem } from "../problems.js";\nexport const p = problem("resource/not-found");`],
  ])("still warns on %s in the shared domain, so the exemption is only L9's", async (_, code) => {
    expect(await restrictedSyntax("packages/shared/src/domain/question.ts", code)).toHaveLength(1);
  });

  it("warns beside the backend's raw-SQL warning rather than replacing it", async () => {
    const code = `import { sql } from "drizzle-orm";\nconst strict = { additionalProperties: false } as const;\nexport const q = sql\`select 1\`;\nexport const s = strict;`;
    const messages = await restrictedSyntax("apps/backend/src/db/definition/drafts.ts", code);

    expect(messages).toHaveLength(2);
    expect(messages.some((message) => message.includes(VOCABULARY))).toBe(true);
    expect(messages.some((message) => message.includes("Raw SQL"))).toBe(true);
  });

  it("warns in a tool config file, which keeps its default export", async () => {
    const code = `const strict = { additionalProperties: false } as const;\nexport default strict;`;
    const messages = await restrictedSyntax("apps/admin/vite.config.ts", code);

    expect(messages).toEqual([expect.stringContaining(VOCABULARY)]);
  });
});
