const PARENTHESIZED_LOCATION = /^ {4}at (.+) \(([^\s()]+):(\d+):(\d+)\)$/;

const PARENTHESIZED_MARKER = /^ {4}at (.+) \((<anonymous>|native)\)$/;

const BARE_LOCATION = /^ {4}at ([^\s()]+):(\d+):(\d+)$/;

const NAME_PART = "(?:_*[A-Za-z$][A-Za-z0-9$]*|<anonymous>)";

const FUNCTION_NAME = new RegExp(`^(?:(?:async|new) )*${NAME_PART}(?:\\.${NAME_PART})*$`);

const MAX_FUNCTION_NAME_LENGTH = 100;

const SCRIPT_FILE = /^[A-Za-z0-9_.-]+\.m?js$/;

const ANONYMOUS_FUNCTION = "anonymous";

const UNKNOWN_SCRIPT = "anonymous.js";

function functionNameOf(name: string): string {
  return name.length <= MAX_FUNCTION_NAME_LENGTH && FUNCTION_NAME.test(name) ? name : ANONYMOUS_FUNCTION;
}

function scriptFileOf(location: string): string {
  const path = location.split(/[?#]/, 1)[0] ?? "";
  const file = path.slice(path.lastIndexOf("/") + 1);
  return SCRIPT_FILE.test(file) ? file : UNKNOWN_SCRIPT;
}

function safeFrame(line: string): string {
  const located = PARENTHESIZED_LOCATION.exec(line);
  if (located !== null) {
    const [, name = "", location = "", row = "", column = ""] = located;
    return `    at ${functionNameOf(name)} (${scriptFileOf(location)}:${row}:${column})`;
  }
  const marked = PARENTHESIZED_MARKER.exec(line);
  if (marked !== null) {
    const [, name = "", marker = ""] = marked;
    return `    at ${functionNameOf(name)} (${marker})`;
  }
  const bare = BARE_LOCATION.exec(line);
  if (bare !== null) {
    const [, location = "", row = "", column = ""] = bare;
    return `    at ${scriptFileOf(location)}:${row}:${column}`;
  }
  return line;
}

export function safeFrames(stack: string): string {
  return stack.split("\n").map(safeFrame).join("\n");
}
