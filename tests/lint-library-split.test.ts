import { describe, expect, it } from "vitest";
import { lintAs } from "./lint-harness.js";

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  return (await lintAs(filePath, code)).filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const ADMIN = "apps/admin/src/screens/questionnaire-list.tsx";
const RESPONDENT = "apps/respondent/src/screens/questionnaire-screen.tsx";
const PRIMITIVE = "packages/ui/src/primitives/dialog.tsx";
const RENDERER = "packages/ui/src/renderer/question.tsx";
const BACKEND = "apps/backend/src/server.ts";

const QUERY = `import { useQuery } from "@tanstack/react-query";`;
const ROUTER = `import { Link } from "@tanstack/react-router";`;
const DND = `import { DndContext } from "@dnd-kit/core";`;
const FORM = `import { useForm } from "@tanstack/react-form";`;
const RADIX = `import { Dialog } from "radix-ui";`;

describe("library split by app (Decisions Log #32)", () => {
  it.each([
    ["TanStack Query", QUERY],
    ["TanStack Router", ROUTER],
    ["dnd-kit", DND],
  ])("allows %s in apps/admin and rejects it elsewhere", async (_, code) => {
    expect(await restrictedImports(ADMIN, code)).toEqual([]);
    expect(await restrictedImports(RESPONDENT, code)).toHaveLength(1);
    expect(await restrictedImports(RENDERER, code)).toHaveLength(1);
    expect(await restrictedImports(BACKEND, code)).toHaveLength(1);
  });

  it("allows TanStack Form in apps/respondent and rejects it elsewhere", async () => {
    expect(await restrictedImports(RESPONDENT, FORM)).toEqual([]);
    expect(await restrictedImports(ADMIN, FORM)).toHaveLength(1);
    expect(await restrictedImports(PRIMITIVE, FORM)).toHaveLength(1);
  });

  it("allows radix-ui in packages/ui/src/primitives and rejects it elsewhere", async () => {
    expect(await restrictedImports(PRIMITIVE, RADIX)).toEqual([]);
    expect(await restrictedImports(RENDERER, RADIX)).toHaveLength(1);
    expect(await restrictedImports(ADMIN, RADIX)).toHaveLength(1);
    expect(await restrictedImports(RESPONDENT, RADIX)).toHaveLength(1);
  });

  it("covers subpaths and every dnd-kit package", async () => {
    expect(await restrictedImports(RESPONDENT, `import { CSS } from "@dnd-kit/utilities";`)).toHaveLength(1);
    expect(await restrictedImports(RESPONDENT, `import { SortableContext } from "@dnd-kit/sortable";`)).toHaveLength(1);
    expect(await restrictedImports(ADMIN, `import { x } from "@tanstack/react-form/nextjs";`)).toHaveLength(1);
  });

  it("covers a workspace's tests, not just its sources", async () => {
    expect(await restrictedImports("apps/admin/_tests/fixtures.ts", QUERY)).toEqual([]);
    expect(await restrictedImports("apps/respondent/_tests/app.test.tsx", QUERY)).toHaveLength(1);
  });

  it("leaves libraries that are not split alone", async () => {
    const code = `import { useState } from "react";\nimport { Type } from "@sinclair/typebox";`;

    expect(await restrictedImports(RESPONDENT, code)).toEqual([]);
    expect(await restrictedImports(ADMIN, code)).toEqual([]);
    expect(await restrictedImports(PRIMITIVE, code)).toEqual([]);
  });

  it("still rejects pino in each home, which inherits the base patterns", async () => {
    const code = `import pino from "pino";`;

    expect(await restrictedImports(ADMIN, code)).toHaveLength(1);
    expect(await restrictedImports(RESPONDENT, code)).toHaveLength(1);
    expect(await restrictedImports(PRIMITIVE, code)).toHaveLength(1);
  });
});
