import { format, inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { Sensitive, sensitive } from "../src/sensitive.js";

const LEAK = "LEAK_DIABETES_8F3A";

describe("Sensitive<T>", () => {
  const answer = sensitive(LEAK);

  it.each<[string, () => string]>([
    ["JSON.stringify, nested", () => JSON.stringify({ itemId: "itm_02", answer })],
    ["template interpolation", () => `answer was ${answer}`],
    ["String()", () => String(answer)],
    ["string concatenation", () => "answer: " + answer],
    ["util.inspect, nested", () => inspect({ answer }, { depth: 5, showHidden: true })],
    ["util.format %s %o %j", () => format("%s %o %j", answer, answer, { answer })],
    ["an Error message", () => new Error(`bad answer ${answer}`).message],
    ["Object spread then stringify", () => JSON.stringify({ ...answer })],
    ["Object.entries", () => JSON.stringify(Object.entries(answer))],
  ])("redacts under %s", (_, render) => {
    const out = render();
    expect(out).not.toContain(LEAK);
  });

  it("unwrap() is the only way out", () => {
    expect(answer.unwrap()).toBe(LEAK);
    expect(sensitive({ optionIds: ["opt_diabetes"] }).unwrap()).toEqual({ optionIds: ["opt_diabetes"] });
    expect(answer).toBeInstanceOf(Sensitive);
  });
});
