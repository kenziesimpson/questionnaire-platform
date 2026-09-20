import { describe, expect, it } from "vitest";
import { captureError, installErrorCapture } from "../../src/browser/errors.js";
import type { QueuedEvent } from "../../src/browser/events.js";
import { createEventQueue } from "../../src/browser/queue.js";
import { FakeWindow } from "./page-fakes.js";

const LEAK = "LEAK_DIABETES_8F3A";

function withStack(error: Error, stack: string): Error {
  error.stack = stack;
  return error;
}

function capturing() {
  const sent: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      sent.push(...events);
    },
    beacon: () => true,
  });
  const page = new FakeWindow();
  const uninstall = installErrorCapture(queue, page);
  return { queue, page, sent, uninstall };
}

describe("installErrorCapture", () => {
  it("listens for errors and unhandled rejections, and stops listening when uninstalled", () => {
    const { page, uninstall } = capturing();

    expect([page.listenerCount("error"), page.listenerCount("unhandledrejection")]).toEqual([1, 1]);
    uninstall();

    expect([page.listenerCount("error"), page.listenerCount("unhandledrejection")]).toEqual([0, 0]);
  });

  it("records an error's type and its stack frames as script file names, and nothing else", () => {
    const { queue, page, sent } = capturing();
    const error = withStack(
      new TypeError(`cannot read ${LEAK}`),
      `TypeError: cannot read ${LEAK}\n    at render (https://app.example.test/assets/index-a1b2.js?v=3:10:20)\n    at http://app.example.test/run/${LEAK}:5:6`,
    );

    page.dispatch("error", { error });
    queue.flush();

    expect(sent).toEqual([
      {
        level: "error",
        at: expect.any(String),
        message: "unhandled error",
        attributes: { "error.type": "TypeError", "error.stack": "    at render (index-a1b2.js:10:20)\n    at anonymous.js:5:6" },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain(LEAK);
  });

  it("never records the message, the file name or the position an error event carries", () => {
    const { queue, page, sent } = capturing();
    const scriptError = { error: undefined, message: `Script error ${LEAK}`, filename: `https://app.example.test/run/${LEAK}`, lineno: 1 };

    page.dispatch("error", scriptError);
    queue.flush();

    expect(sent).toEqual([{ level: "error", at: expect.any(String), message: "unhandled error", attributes: {} }]);
  });

  it("records the type and frames of a rejection's reason, and nothing for a reason that is not an error", () => {
    const { queue, page, sent } = capturing();

    page.dispatch("unhandledrejection", { reason: withStack(new RangeError(LEAK), `RangeError: ${LEAK}\n    at go (main.js:1:2)`) });
    page.dispatch("unhandledrejection", { reason: LEAK });
    page.dispatch("unhandledrejection", { reason: { message: LEAK, answer: LEAK } });
    page.dispatch("unhandledrejection", {});
    queue.flush();

    expect(sent).toEqual([
      { level: "error", at: expect.any(String), message: "unhandled rejection", attributes: { "error.type": "RangeError", "error.stack": "    at go (main.js:1:2)" } },
      { level: "error", at: expect.any(String), message: "unhandled rejection", attributes: {} },
      { level: "error", at: expect.any(String), message: "unhandled rejection", attributes: {} },
      { level: "error", at: expect.any(String), message: "unhandled rejection", attributes: {} },
    ]);
  });

  it("records no stack when the stack does not begin with the error's own message", () => {
    const { queue, page, sent } = capturing();
    const error = withStack(new Error("innocent"), `Error: ${LEAK}\n    at go (main.js:1:2)`);

    page.dispatch("error", { error });
    queue.flush();

    expect(sent[0]?.attributes).toEqual({ "error.type": "Error" });
  });

  it("keeps only the frame lines of a stack, so a line carrying a message is dropped", () => {
    const { queue, page, sent } = capturing();
    const error = withStack(new Error("boom"), `Error: boom\n    at go (main.js:1:2)\n${LEAK}\n    at stop (main.js:3:4)\n  ${LEAK}`);

    page.dispatch("error", { error });
    queue.flush();

    expect(sent[0]?.attributes["error.stack"]).toBe("    at go (main.js:1:2)\n    at stop (main.js:3:4)");
    expect(JSON.stringify(sent)).not.toContain(LEAK);
  });

  it("skips a frame-shaped line inside a multi-line message", () => {
    const { queue, page, sent } = capturing();
    const message = `first\n    at leak (${LEAK}.js:1:1)`;
    const error = withStack(new Error(message), `Error: ${message}\n    at go (main.js:1:2)`);

    page.dispatch("error", { error });
    queue.flush();

    expect(sent[0]?.attributes["error.stack"]).toBe("    at go (main.js:1:2)");
    expect(JSON.stringify(sent)).not.toContain(LEAK);
  });

  it("records no stack for a browser whose frames are not in the V8 shape", () => {
    const { queue, page, sent } = capturing();
    const error = withStack(new Error("boom"), "go@https://app.example.test/main.js:1:2\nstop@https://app.example.test/main.js:3:4");

    page.dispatch("error", { error });
    queue.flush();

    expect(sent[0]?.attributes).toEqual({ "error.type": "Error" });
  });

  it("keeps a function name only when it has the shape of an identifier path", () => {
    const { queue, page, sent } = capturing();
    const stack = [
      "Error: boom",
      "    at Object.type 2 diabetes (main.js:1:2)",
      `    at Object.${LEAK} (main.js:3:4)`,
      "    at async Promise.all (main.js:5:6)",
      "    at Object.<anonymous> (main.js:7:8)",
      "    at new Screen (main.js:9:10)",
    ].join("\n");

    page.dispatch("error", { error: withStack(new Error("boom"), stack) });
    queue.flush();

    expect(sent[0]?.attributes["error.stack"]).toBe(
      [
        "    at anonymous (main.js:1:2)",
        "    at anonymous (main.js:3:4)",
        "    at async Promise.all (main.js:5:6)",
        "    at Object.<anonymous> (main.js:7:8)",
        "    at new Screen (main.js:9:10)",
      ].join("\n"),
    );
  });

  it("listens once per page however often it is installed", () => {
    const { queue, page, sent, uninstall } = capturing();

    const again = installErrorCapture(queue, page);
    page.dispatch("error", { error: new Error("boom") });
    queue.flush();

    expect(again).toBe(uninstall);
    expect([page.listenerCount("error"), page.listenerCount("unhandledrejection")]).toEqual([1, 1]);
    expect(sent).toHaveLength(1);
    uninstall();
    expect(installErrorCapture(queue, page)).not.toBe(uninstall);
  });

  it("drops an error name that is not a class name", () => {
    const { queue, page, sent } = capturing();
    const error = new Error("boom");
    error.name = LEAK;

    page.dispatch("error", { error });
    queue.flush();

    expect(sent[0]?.attributes["error.type"]).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain(LEAK);
  });
});

describe("captureError", () => {
  it("names each kind of failure with a fixed message", () => {
    const { queue, sent } = capturing();

    captureError(queue, "render", withStack(new Error("x"), "Error: x\n    at Screen (app.js:1:2)"));
    captureError(queue, "error", undefined);
    captureError(queue, "rejection", undefined);
    queue.flush();

    expect(sent.map((event) => event.message)).toEqual(["render error", "unhandled error", "unhandled rejection"]);
  });

  it("never throws, whether the queue throws or the error misbehaves", () => {
    const throwingQueue = {
      enqueueRecord: () => {
        throw new Error(LEAK);
      },
    };
    const hostile = new Error("boom");
    Object.defineProperty(hostile, "name", {
      get: () => {
        throw new Error(LEAK);
      },
    });
    const { queue } = capturing();

    expect(() => {
      captureError(throwingQueue, "error", new Error(LEAK));
      captureError(queue, "error", hostile);
    }).not.toThrow();
  });
});
