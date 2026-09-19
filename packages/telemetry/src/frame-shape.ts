const NAME_PART = "(?:_*[A-Za-z$][A-Za-z0-9$]*|<anonymous>)";

const FUNCTION_NAME = `(?:(?:async|new) )*${NAME_PART}(?:\\.${NAME_PART})*`;

const SCRIPT_FILE = "[A-Za-z0-9_.-]{1,80}\\.m?js";

const POSITION = "\\d{1,7}:\\d{1,7}";

export const MAX_BROWSER_FRAMES = 40;

export const MAX_BROWSER_FRAME_LENGTH = 200;

export const BROWSER_STACK_FRAME = new RegExp(
  `^ {4}at (?:${FUNCTION_NAME} \\((?:${SCRIPT_FILE}:${POSITION}|<anonymous>|native)\\)|${SCRIPT_FILE}:${POSITION})$`,
);

export function isBrowserStack(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const lines = value.split("\n");
  return (
    lines.length <= MAX_BROWSER_FRAMES &&
    lines.every((line) => line.length <= MAX_BROWSER_FRAME_LENGTH && BROWSER_STACK_FRAME.test(line))
  );
}
