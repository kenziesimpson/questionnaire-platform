import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Type, { type Static } from "typebox";
import { Value } from "typebox/value";
import type { ComposeStack } from "./compose-stack.ts";

export const KEPT_STACKS_DIRECTORY = fileURLToPath(new URL("../.stacks", import.meta.url));

const KeptStackRecord = Type.Object({
  projectName: Type.String({ minLength: 1 }),
  startedAt: Type.String({ minLength: 1 }),
  endpoints: Type.Object({
    baseUrl: Type.String({ minLength: 1 }),
    databaseUrl: Type.String({ minLength: 1 }),
  }),
});
export type KeptStackRecord = Static<typeof KeptStackRecord>;

function recordPath(projectName: string): string {
  return join(KEPT_STACKS_DIRECTORY, `${projectName}.json`);
}

export async function recordKeptStack(stack: ComposeStack): Promise<KeptStackRecord> {
  const record: KeptStackRecord = { ...stack, startedAt: new Date().toISOString() };
  await mkdir(KEPT_STACKS_DIRECTORY, { recursive: true });
  await writeFile(recordPath(stack.projectName), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function forgetKeptStack(projectName: string): Promise<void> {
  await rm(recordPath(projectName), { force: true });
}

async function readRecord(fileName: string): Promise<KeptStackRecord | undefined> {
  const parsed: unknown = JSON.parse(await readFile(join(KEPT_STACKS_DIRECTORY, fileName), "utf8"));
  return Value.Check(KeptStackRecord, parsed) ? parsed : undefined;
}

export async function listKeptStacks(): Promise<KeptStackRecord[]> {
  const fileNames = await readdir(KEPT_STACKS_DIRECTORY).catch(() => []);
  const records = await Promise.all(fileNames.filter((name) => name.endsWith(".json")).map(readRecord));
  return records.filter((record) => record !== undefined);
}
