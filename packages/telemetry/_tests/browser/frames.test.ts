import { describe, expect, it } from "vitest";
import { safeFrames } from "../../src/browser/frames.js";
import { stackFramesOf } from "../../src/fields.js";
import {
  isBrowserStack,
  MAX_BROWSER_FRAME_LENGTH,
  MAX_STACK_FRAMES,
  MAX_FUNCTION_NAME_LENGTH,
  MAX_POSITION_DIGITS,
  MAX_SCRIPT_BASENAME_LENGTH,
  PLACEHOLDER_FRAME,
} from "../../src/frame-shape.js";

const LEAK = "LEAK_DIABETES_8F3A";

const SESSION = "5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d";

const frame = (text: string) => `    at ${text}`;

const HOSTILE_AND_ORDINARY: readonly (readonly [string, string])[] = [
  ["an ordinary frame", frame("render (index-Ab3_x.js:10:20)")],
  ["a file name at the length cap", frame(`render (${"a".repeat(MAX_SCRIPT_BASENAME_LENGTH)}.js:1:2)`)],
  ["a file name one over the length cap", frame(`render (${"a".repeat(MAX_SCRIPT_BASENAME_LENGTH + 1)}.js:1:2)`)],
  ["a file name of three hundred characters", frame(`render (${"a".repeat(300)}.mjs:1:2)`)],
  ["a position at the digit cap", frame(`render (x.js:${"9".repeat(MAX_POSITION_DIGITS)}:${"9".repeat(MAX_POSITION_DIGITS)})`)],
  ["an eight-digit line", frame(`render (x.js:${"1".repeat(MAX_POSITION_DIGITS + 1)}:2)`)],
  ["an eight-digit column", frame(`render (x.js:1:${"2".repeat(MAX_POSITION_DIGITS + 1)})`)],
  ["a bare location with an eight-digit position", frame(`x.js:${"1".repeat(MAX_POSITION_DIGITS + 1)}:2`)],
  ["a function name of three hundred characters", frame(`${"a".repeat(300)} (x.js:1:1)`)],
  ["a function name at the length cap", frame(`${"a".repeat(MAX_FUNCTION_NAME_LENGTH)} (x.js:1:1)`)],
  ["a function name one over the length cap", frame(`${"a".repeat(MAX_FUNCTION_NAME_LENGTH + 1)} (x.js:1:1)`)],
  [
    "a long name and a long file that together pass the line cap",
    frame(`${"a".repeat(MAX_FUNCTION_NAME_LENGTH)} (${"b".repeat(MAX_SCRIPT_BASENAME_LENGTH)}.mjs:1234567:1234567)`),
  ],
  ["a URL location with a session id in its path", frame(`render (https://app.example.test/run/${SESSION}/step.js:1:2)`)],
  ["a URL location with a query string", frame("render (https://app.example.test/assets/main.js?next=/run/x&cursor=abc:1:2)")],
  ["a URL location with a fragment", frame("render (https://app.example.test/assets/main.js#/run/x:1:2)")],
  ["a URL whose last segment is a session id", frame(`render (https://app.example.test/run/${SESSION}:1:2)`)],
  ["a bare URL location", frame(`https://app.example.test/run/${SESSION}/main.js:5:6`)],
  ["a file path location", frame("render (/srv/app/dist/main.js:1:2)")],
  ["a location with no script file", frame("render (https://app.example.test/:1:2)")],
  ["an anonymous marker", frame("async Promise.all (<anonymous>)")],
  ["a native marker", frame("Array.map (native)")],
  ["a constructor", frame("new Screen (main.js:9:10)")],
  ["an anonymous member", frame("Object.<anonymous> (main.js:7:8)")],
  ["a phrase for a function name", frame("type 2 diabetes (main.js:1:2)")],
  ["the sentinel as a dotted function name", frame(`Object.${LEAK} (main.js:3:4)`)],
  ["the sentinel and a phrase as a function name", frame(`${LEAK} patient answered yes (main.js:1:1)`)],
  ["the sentinel in a URL host", frame(`render (https://${LEAK}.example.test/main.js:1:2)`)],
  ["the sentinel in a URL path segment", frame(`render (https://app.example.test/${LEAK}/main.js:1:2)`)],
  ["the sentinel in a query string", frame(`render (https://app.example.test/main.js?answer=${LEAK}:1:2)`)],
  ["a frame made of many kinds", [frame("a (x.js:1:1)"), frame("b (<anonymous>)"), frame("c.js:2:2"), frame("d (native)")].join("\n")],
  ["sixty frames", Array.from({ length: 60 }, (_unused, index) => frame(`step${index} (main.js:${index + 1}:1)`)).join("\n")],
  ["sixty frames of the placeholder kind", Array.from({ length: 60 }, () => frame(`${"a".repeat(300)} (${"b".repeat(300)}.js:1:1)`)).join("\n")],
];

describe("safeFrames and isBrowserStack agree on one definition of a safe frame", () => {
  it.each(HOSTILE_AND_ORDINARY)("makes %s a stack the ingest accepts", (_name, raw) => {
    expect(isBrowserStack(safeFrames(raw))).toBe(true);
  });

  it.each(HOSTILE_AND_ORDINARY)("keeps the sentinel and the session id out of the rewritten stack for %s", (_name, raw) => {
    const rewritten = safeFrames(raw);

    expect(rewritten).not.toContain(LEAK);
    expect(rewritten.toLowerCase()).not.toContain(LEAK.toLowerCase());
    expect(rewritten).not.toContain(SESSION);
    expect(rewritten).not.toContain("https:");
    expect(rewritten).not.toContain("?");
  });

  it("never yields more than the frame cap, and no line over the line cap", () => {
    for (const [, raw] of HOSTILE_AND_ORDINARY) {
      const lines = safeFrames(raw).split("\n");

      expect(lines.length).toBeLessThanOrEqual(MAX_STACK_FRAMES);
      expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(MAX_BROWSER_FRAME_LENGTH);
    }
  });

  it("cuts sixty frames to the frame cap, keeping the first ones", () => {
    const raw = Array.from({ length: 60 }, (_unused, index) => frame(`step${index} (main.js:${index + 1}:1)`)).join("\n");

    const lines = safeFrames(raw).split("\n");

    expect(lines).toHaveLength(MAX_STACK_FRAMES);
    expect(lines[0]).toBe("    at step0 (main.js:1:1)");
    expect(lines.at(-1)).toBe(`    at step${MAX_STACK_FRAMES - 1} (main.js:${MAX_STACK_FRAMES}:1)`);
  });

  it.each([
    ["a file name over the cap becomes the unknown script", frame(`render (${"a".repeat(MAX_SCRIPT_BASENAME_LENGTH + 1)}.js:1:2)`), "    at render (anonymous.js:1:2)"],
    ["a position over the digit cap becomes the placeholder frame", frame(`render (x.js:${"1".repeat(MAX_POSITION_DIGITS + 1)}:2)`), PLACEHOLDER_FRAME],
    ["a bare position over the digit cap becomes the placeholder frame", frame(`x.js:1:${"2".repeat(MAX_POSITION_DIGITS + 1)}`), PLACEHOLDER_FRAME],
    ["a function name over the cap becomes anonymous", frame(`${"a".repeat(MAX_FUNCTION_NAME_LENGTH + 1)} (x.js:1:1)`), "    at anonymous (x.js:1:1)"],
    [
      "a line over the line cap becomes the placeholder frame",
      frame(`${"a".repeat(MAX_FUNCTION_NAME_LENGTH)} (${"b".repeat(MAX_SCRIPT_BASENAME_LENGTH)}.mjs:1234567:1234567)`),
      PLACEHOLDER_FRAME,
    ],
    ["a name and file at their caps stay as they are", frame(`${"a".repeat(60)} (${"b".repeat(MAX_SCRIPT_BASENAME_LENGTH)}.js:1:2)`), frame(`${"a".repeat(60)} (${"b".repeat(MAX_SCRIPT_BASENAME_LENGTH)}.js:1:2)`)],
  ])("%s", (_name, raw, expected) => {
    expect(safeFrames(raw)).toBe(expected);
  });

  it("leaves a line that is not a frame alone, so the registry check drops the whole stack", () => {
    expect(isBrowserStack(safeFrames(`${frame("go (main.js:1:2)")}\n${LEAK}`))).toBe(false);
  });
});

describe("the stack an error produces, from each browser's raw format", () => {
  function producedFrom(raw: string): string | undefined {
    const error = new Error("boom");
    error.stack = `Error: boom\n${raw}`;
    const frames = stackFramesOf(error);
    return frames === undefined ? undefined : safeFrames(frames);
  }

  it.each([
    ["V8 with a URL location", frame(`render (https://app.example.test/assets/index-a1b2.js?v=3:10:20)\n${frame(`http://app.example.test/run/${SESSION}:5:6`)}`)],
    ["V8 with sixty frames", Array.from({ length: 60 }, (_unused, index) => frame(`step${index} (${"f".repeat(90)}.js:${"9".repeat(9)}:1)`)).join("\n")],
    ["Firefox", `go@https://app.example.test/main.js:1:2\nstop@https://app.example.test/run/${SESSION}/main.js:3:4`],
    ["Safari", `go@https://app.example.test/main.js:1:2\nglobal code@https://app.example.test/main.js:9:9\n[native code]`],
    ["Firefox with a sentinel function name", `${LEAK} patient answered yes@https://app.example.test/main.js:1:2`],
  ])("is absent or accepted by the ingest for %s", (_name, raw) => {
    const produced = producedFrom(raw);

    expect(produced === undefined || isBrowserStack(produced)).toBe(true);
    expect(produced ?? "").not.toContain(LEAK);
    expect(produced ?? "").not.toContain(SESSION);
  });

  it("produces nothing for a browser whose frames are not in the V8 shape", () => {
    expect(producedFrom(`go@https://app.example.test/main.js:1:2\nglobal code@https://app.example.test/main.js:9:9`)).toBeUndefined();
  });
});
