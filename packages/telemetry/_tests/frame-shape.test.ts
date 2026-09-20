import { describe, expect, it } from "vitest";
import {
  BROWSER_STACK_FRAME,
  FUNCTION_NAME,
  isBrowserStack,
  isSafeFunctionName,
  isSafePosition,
  isSafeScriptFile,
  MAX_BROWSER_FRAME_LENGTH,
  MAX_STACK_FRAMES,
  MAX_FUNCTION_NAME_LENGTH,
  MAX_POSITION_DIGITS,
  MAX_SCRIPT_BASENAME_LENGTH,
  NAME_PART,
  POSITION,
  SCRIPT_FILE,
  SERVER_STACK_FRAME,
} from "../src/frame-shape.js";

const LEAK = "LEAK_DIABETES_8F3A";

describe("BROWSER_STACK_FRAME", () => {
  it.each([
    "    at render (index.js:1:2)",
    "    at Object.render (index-Ab3_x.mjs:10:20)",
    "    at async new App.load (chunk-1.js:5:6)",
    "    at render (<anonymous>)",
    "    at anonymous (native)",
    "    at index.js:3:4",
  ])("accepts %j", (line) => {
    expect(BROWSER_STACK_FRAME.test(line)).toBe(true);
  });

  it.each([
    `    at ${LEAK} (x.js:1:1)`,
    `    at fn (${LEAK}.txt:1:1)`,
    "    at fn (http://host/x.js:1:1)",
    "    at fn (x.js:1)",
    "    at fn (x.js:a:b)",
    "    at two words (x.js:1:1)",
    "    at fn (x.js:1:1) trailing",
    "at fn (x.js:1:1)",
    "     at fn (x.js:1:1)",
  ])("rejects %j", (line) => {
    expect(BROWSER_STACK_FRAME.test(line)).toBe(false);
  });
});

const BROWSER_FRAMES = [
  "    at render (index.js:1:2)",
  "    at Object.render (index-Ab3_x.mjs:10:20)",
  "    at async new App.load (chunk-1.js:5:6)",
  "    at render (<anonymous>)",
  "    at anonymous (native)",
  "    at index.js:3:4",
];

const NODE_FRAMES = [
  "    at Object.render (/app/dist/server/render.js:10:20)",
  "    at Module._compile (node:internal/modules/cjs/loader:1554:14)",
  "    at file:///app/dist/index.js:3:4",
  "    at new Foo (/app/node_modules/pkg/lib/foo.cjs:1:1)",
];

describe("the server and browser stack-frame grammars", () => {
  it.each(BROWSER_FRAMES)("the server accepts every frame the browser accepts: %j", (line) => {
    expect(BROWSER_STACK_FRAME.test(line)).toBe(true);
    expect(SERVER_STACK_FRAME.test(line)).toBe(true);
  });

  it.each(NODE_FRAMES)("the server is looser on purpose, because a Node frame carries an absolute path or a scheme: %j", (line) => {
    expect(SERVER_STACK_FRAME.test(line)).toBe(true);
    expect(BROWSER_STACK_FRAME.test(line)).toBe(false);
  });
});

describe("isBrowserStack", () => {
  it("accepts one frame per line up to the frame cap and refuses one more", () => {
    const frame = "    at render (x.js:1:1)";

    expect(isBrowserStack(Array.from({ length: MAX_STACK_FRAMES }, () => frame).join("\n"))).toBe(true);
    expect(isBrowserStack(Array.from({ length: MAX_STACK_FRAMES + 1 }, () => frame).join("\n"))).toBe(false);
  });

  it("refuses a line over the length cap even if its shape is right", () => {
    const long = `    at ${"a".repeat(MAX_BROWSER_FRAME_LENGTH)} (x.js:1:1)`;

    expect(BROWSER_STACK_FRAME.test(long)).toBe(true);
    expect(isBrowserStack(long)).toBe(false);
  });

  it.each([undefined, null, 7, "", "\n", "    at render (x.js:1:1)\n", `    at render (x.js:1:1)\n${LEAK}`])("refuses %j", (value) => {
    expect(isBrowserStack(value)).toBe(false);
  });
});

describe("the building blocks", () => {
  it("compose the frame pattern from the same pieces the SDK's rewriter checks", () => {
    expect(new RegExp(`^${NAME_PART}$`).test("_render")).toBe(true);
    expect(new RegExp(`^${FUNCTION_NAME}$`).test("async Object.<anonymous>")).toBe(true);
    expect(new RegExp(`^${SCRIPT_FILE}$`).test("main.mjs")).toBe(true);
    expect(new RegExp(`^${POSITION}$`).test("12:34")).toBe(true);
  });

  it("accept a function name up to the length cap and no further", () => {
    expect(isSafeFunctionName("a".repeat(MAX_FUNCTION_NAME_LENGTH))).toBe(true);
    expect(isSafeFunctionName("a".repeat(MAX_FUNCTION_NAME_LENGTH + 1))).toBe(false);
    expect(isSafeFunctionName(LEAK)).toBe(false);
    expect(isSafeFunctionName("two words")).toBe(false);
  });

  it("accept a script file whose base name is at most the cap, and only .js or .mjs", () => {
    expect(isSafeScriptFile(`${"a".repeat(MAX_SCRIPT_BASENAME_LENGTH)}.js`)).toBe(true);
    expect(isSafeScriptFile(`${"a".repeat(MAX_SCRIPT_BASENAME_LENGTH + 1)}.js`)).toBe(false);
    expect(isSafeScriptFile("main.ts")).toBe(false);
    expect(isSafeScriptFile("dir/main.js")).toBe(false);
    expect(isSafeScriptFile("")).toBe(false);
  });

  it("accept a position of up to the digit cap in each part", () => {
    expect(isSafePosition("1".repeat(MAX_POSITION_DIGITS), "1")).toBe(true);
    expect(isSafePosition("1", "1".repeat(MAX_POSITION_DIGITS + 1))).toBe(false);
    expect(isSafePosition("a", "1")).toBe(false);
  });

  it("make the ingest refuse a frame whose function name is over the name cap though the line is short enough", () => {
    const name = "a".repeat(MAX_FUNCTION_NAME_LENGTH + 1);

    expect(BROWSER_STACK_FRAME.test(`    at ${name} (x.js:1:1)`)).toBe(true);
    expect(isBrowserStack(`    at ${name} (x.js:1:1)`)).toBe(false);
  });
});
