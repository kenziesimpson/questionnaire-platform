import { describe, expect, it } from "vitest";
import { BROWSER_STACK_FRAME, isBrowserStack, MAX_BROWSER_FRAME_LENGTH, MAX_BROWSER_FRAMES } from "../src/frame-shape.js";

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

describe("isBrowserStack", () => {
  it("accepts one frame per line up to the frame cap and refuses one more", () => {
    const frame = "    at render (x.js:1:1)";

    expect(isBrowserStack(Array.from({ length: MAX_BROWSER_FRAMES }, () => frame).join("\n"))).toBe(true);
    expect(isBrowserStack(Array.from({ length: MAX_BROWSER_FRAMES + 1 }, () => frame).join("\n"))).toBe(false);
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
