import {
  ANONYMOUS_FUNCTION,
  isSafeFunctionName,
  isSafePosition,
  isSafeScriptFile,
  MAX_BROWSER_FRAME_LENGTH,
  MAX_STACK_FRAMES,
  PLACEHOLDER_FRAME,
  UNKNOWN_SCRIPT,
} from "../frame-shape.js";

const PARENTHESIZED_LOCATION = /^ {4}at (.+) \(([^\s()]+):(\d+):(\d+)\)$/;

const PARENTHESIZED_MARKER = /^ {4}at (.+) \((<anonymous>|native)\)$/;

const BARE_LOCATION = /^ {4}at ([^\s()]+):(\d+):(\d+)$/;

function functionNameOf(name: string): string {
  return isSafeFunctionName(name) ? name : ANONYMOUS_FUNCTION;
}

function scriptFileOf(location: string): string {
  const path = location.split(/[?#]/, 1)[0] ?? "";
  const file = path.slice(path.lastIndexOf("/") + 1);
  return isSafeScriptFile(file) ? file : UNKNOWN_SCRIPT;
}

function withinLineCap(frame: string): string {
  return frame.length <= MAX_BROWSER_FRAME_LENGTH ? frame : PLACEHOLDER_FRAME;
}

function safeFrame(line: string): string {
  const located = PARENTHESIZED_LOCATION.exec(line);
  if (located !== null) {
    const [, name = "", location = "", row = "", column = ""] = located;
    if (!isSafePosition(row, column)) return PLACEHOLDER_FRAME;
    return withinLineCap(`    at ${functionNameOf(name)} (${scriptFileOf(location)}:${row}:${column})`);
  }
  const marked = PARENTHESIZED_MARKER.exec(line);
  if (marked !== null) {
    const [, name = "", marker = ""] = marked;
    return withinLineCap(`    at ${functionNameOf(name)} (${marker})`);
  }
  const bare = BARE_LOCATION.exec(line);
  if (bare !== null) {
    const [, location = "", row = "", column = ""] = bare;
    if (!isSafePosition(row, column)) return PLACEHOLDER_FRAME;
    return withinLineCap(`    at ${scriptFileOf(location)}:${row}:${column}`);
  }
  return line;
}

export function safeFrames(stack: string): string {
  return stack.split("\n").slice(0, MAX_STACK_FRAMES).map(safeFrame).join("\n");
}
