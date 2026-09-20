import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Type, { type Static } from "typebox";
import { Value } from "typebox/value";

const runDocker = promisify(execFile);

const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

const FRONTEND_SERVICE_LABEL = "label=com.docker.compose.service=frontend";

const AccessLine = Type.Object(
  {
    msg: Type.Literal("request completed"),
    "http.request.method": Type.String(),
    "http.route": Type.String(),
    "http.response.status_code": Type.Integer(),
    trace_id: Type.String(),
    span_id: Type.String(),
  },
  { additionalProperties: false },
);
export type AccessLine = Static<typeof AccessLine>;

export interface FrontendOutput {
  readonly stdoutLines: readonly string[];
  readonly all: string;
}

export interface ParsedAccessLines {
  readonly lines: readonly AccessLine[];
  readonly invalid: readonly string[];
}

export async function frontendContainerId(baseUrl: string): Promise<string> {
  const { stdout } = await runDocker("docker", [
    "ps",
    "--filter",
    FRONTEND_SERVICE_LABEL,
    "--filter",
    `publish=${new URL(baseUrl).port}`,
    "--format",
    "{{.ID}}",
  ]);
  const ids = stdout.split("\n").filter((id) => id.trim() !== "");
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    throw new Error(`Expected one running frontend container publishing the port of ${baseUrl}, found ${ids.length}`);
  }
  return id.trim();
}

export async function frontendOutput(containerId: string): Promise<FrontendOutput> {
  const { stdout, stderr } = await runDocker("docker", ["logs", containerId], { maxBuffer: MAX_OUTPUT_BYTES });
  return { stdoutLines: stdout.split("\n").filter((line) => line !== ""), all: `${stdout}\n${stderr}` };
}

export async function nginxConfigTest(containerId: string): Promise<string> {
  const { stderr } = await runDocker("docker", ["exec", containerId, "nginx", "-t"]);
  return stderr;
}

function parsedLine(text: string): AccessLine | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return Value.Check(AccessLine, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function accessLinesOf(stdoutLines: readonly string[]): ParsedAccessLines {
  const candidates = stdoutLines.filter((line) => line.startsWith("{"));
  const lines: AccessLine[] = [];
  const invalid: string[] = [];
  for (const candidate of candidates) {
    const line = parsedLine(candidate);
    if (line === undefined) invalid.push(candidate);
    else lines.push(line);
  }
  return { lines, invalid };
}
