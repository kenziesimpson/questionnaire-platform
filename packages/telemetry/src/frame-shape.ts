export const NAME_PART = "(?:_*[A-Za-z$][A-Za-z0-9$]*|<anonymous>)";

export const FUNCTION_NAME = `(?:(?:async|new) )*${NAME_PART}(?:\\.${NAME_PART})*`;

export const MAX_SCRIPT_BASENAME_LENGTH = 80;

export const SCRIPT_FILE = `[A-Za-z0-9_.-]{1,${MAX_SCRIPT_BASENAME_LENGTH}}\\.m?js`;

export const MAX_POSITION_DIGITS = 7;

export const POSITION = `\\d{1,${MAX_POSITION_DIGITS}}:\\d{1,${MAX_POSITION_DIGITS}}`;

export const MAX_FUNCTION_NAME_LENGTH = 100;

export const MAX_BROWSER_FRAMES = 40;

export const MAX_BROWSER_FRAME_LENGTH = 200;

export const ANONYMOUS_FUNCTION = "anonymous";

export const UNKNOWN_SCRIPT = "anonymous.js";

export const PLACEHOLDER_FRAME = `    at ${ANONYMOUS_FUNCTION} (${UNKNOWN_SCRIPT}:0:0)`;

const FUNCTION_NAME_SHAPE = new RegExp(`^${FUNCTION_NAME}$`);

const SCRIPT_FILE_SHAPE = new RegExp(`^${SCRIPT_FILE}$`);

const POSITION_SHAPE = new RegExp(`^${POSITION}$`);

export const BROWSER_STACK_FRAME = new RegExp(
  `^ {4}at (?:(?<name>${FUNCTION_NAME}) \\((?:${SCRIPT_FILE}:${POSITION}|<anonymous>|native)\\)|${SCRIPT_FILE}:${POSITION})$`,
);

export function isSafeFunctionName(name: string): boolean {
  return name.length <= MAX_FUNCTION_NAME_LENGTH && FUNCTION_NAME_SHAPE.test(name);
}

export function isSafeScriptFile(file: string): boolean {
  return SCRIPT_FILE_SHAPE.test(file);
}

export function isSafePosition(row: string, column: string): boolean {
  return POSITION_SHAPE.test(`${row}:${column}`);
}

function isBrowserFrame(line: string): boolean {
  if (line.length > MAX_BROWSER_FRAME_LENGTH) return false;
  const match = BROWSER_STACK_FRAME.exec(line);
  return match !== null && (match.groups?.name === undefined || match.groups.name.length <= MAX_FUNCTION_NAME_LENGTH);
}

export function isBrowserStack(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const lines = value.split("\n");
  return lines.length <= MAX_BROWSER_FRAMES && lines.every(isBrowserFrame);
}
