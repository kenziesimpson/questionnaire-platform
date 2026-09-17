import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

export async function lintAs(filePath: string, code: string): Promise<ESLint.LintResult["messages"]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
}
