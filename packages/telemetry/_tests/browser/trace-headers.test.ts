import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectTraceHeaders, pageTraceparent, type HeadersInput } from "../../src/browser/trace-headers.js";
import { installFaultyMeter, internalDropsOf, restoreFaults } from "../faults.js";

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/;

const STALE = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

const BROWSER_SOURCES = fileURLToPath(new URL("../../src/browser/", import.meta.url));

afterEach(() => {
  restoreFaults();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function partsOf(traceparent: string | undefined): { version: string; traceId: string; spanId: string; flags: string } {
  const [version = "", traceId = "", spanId = "", flags = ""] = (traceparent ?? "").split("-");
  return { version, traceId, spanId, flags };
}

function pageTraceId(): string {
  return partsOf(injectTraceHeaders().traceparent).traceId;
}

async function freshPage() {
  vi.resetModules();
  return import("../../src/browser/trace-headers.js");
}

describe("injectTraceHeaders: the page trace id", () => {
  it("adds a traceparent to every request, with no span active and nothing started, and no other header", () => {
    const headers = injectTraceHeaders({ accept: "application/json" });

    expect(Object.keys(headers).sort()).toEqual(["accept", "traceparent"]);
    expect(headers.traceparent).toMatch(TRACEPARENT);
  });

  it("adds one to a call with no headers at all", () => {
    expect(Object.keys(injectTraceHeaders())).toEqual(["traceparent"]);
  });

  it("is version 00, a 32-hex trace id that is not zero, a 16-hex span id that is not zero, and flags 00", () => {
    const { version, traceId, spanId, flags } = partsOf(injectTraceHeaders().traceparent);

    expect(version).toBe("00");
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(traceId).not.toMatch(/^0+$/);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(spanId).not.toMatch(/^0+$/);
    expect(flags).toBe("00");
  });

  it("carries ids only: no route, url, session id, query or answer", () => {
    const { traceparent } = injectTraceHeaders({ accept: "application/json" });

    expect(traceparent?.split("-")).toHaveLength(4);
    expect(traceparent).not.toMatch(/[/:?=]/);
  });

  it("keeps one trace id for the whole page and a fresh span id for each request", () => {
    const requests = Array.from({ length: 25 }, () => partsOf(injectTraceHeaders().traceparent));

    expect(new Set(requests.map(({ traceId }) => traceId)).size).toBe(1);
    expect(new Set(requests.map(({ spanId }) => spanId)).size).toBe(25);
  });

  it("stamps a queue's events with the same trace id and a fresh span id each time", () => {
    const stamped = [partsOf(pageTraceparent()), partsOf(pageTraceparent())];

    expect(stamped[0]?.traceId).toBe(pageTraceId());
    expect(stamped[1]?.traceId).toBe(stamped[0]?.traceId);
    expect(stamped[1]?.spanId).not.toBe(stamped[0]?.spanId);
  });

  it("is a different trace id on the next page load, which is a fresh copy of the module", async () => {
    const first = pageTraceId();
    const next = await freshPage();

    expect(partsOf(next.injectTraceHeaders().traceparent).traceId).not.toBe(first);
  });

  it("draws every id from crypto.getRandomValues", () => {
    const random = vi.spyOn(globalThis.crypto, "getRandomValues");

    injectTraceHeaders();

    expect(random.mock.calls.map(([array]) => array.byteLength)).toContain(8);
  });

  it("draws again for a trace id that comes out all zero, so the page id is never zero", async () => {
    const next = await freshPage();
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementationOnce((array) => array);

    const { traceId } = partsOf(next.injectTraceHeaders().traceparent);

    expect(traceId).not.toMatch(/^0+$/);
  });

  it("draws again for a span id that comes out all zero", () => {
    injectTraceHeaders();
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementationOnce((array) => array);

    const { spanId } = partsOf(injectTraceHeaders().traceparent);

    expect(spanId).not.toMatch(/^0+$/);
  });
});

describe("the page trace id is kept in memory only", () => {
  function touchedStores(): string[] {
    const touched: string[] = [];
    const store = new Proxy(
      {},
      {
        get: (_target, key) => {
          touched.push(`store.${String(key)}`);
          return undefined;
        },
        set: (_target, key) => {
          touched.push(`store.${String(key)}`);
          return true;
        },
      },
    );
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("sessionStorage", store);
    vi.stubGlobal("indexedDB", store);
    vi.stubGlobal("caches", store);
    vi.stubGlobal("document", {
      get cookie() {
        touched.push("cookie.get");
        return "";
      },
      set cookie(_value: string) {
        touched.push("cookie.set");
      },
    });
    return touched;
  }

  it("reads and writes no storage, cookie or cache while it is minted and used", () => {
    const touched = touchedStores();

    injectTraceHeaders({ accept: "application/json" });
    pageTraceparent();

    expect(touched).toEqual([]);
  });

  it("is not named by any source in the browser SDK: no localStorage, sessionStorage, indexedDB, cookie or cache", () => {
    const sources = readdirSync(BROWSER_SOURCES).filter((name) => name.endsWith(".ts"));

    expect(sources.length).toBeGreaterThan(5);
    for (const name of sources) {
      expect(readFileSync(`${BROWSER_SOURCES}${name}`, "utf8"), name).not.toMatch(/localStorage|sessionStorage|indexedDB|\.cookie|caches\./);
    }
  });
});

describe("injectTraceHeaders: the input shapes", () => {
  it("accepts a Headers object, lower-casing its names, and replaces a stale traceparent with the page's", () => {
    const headers = injectTraceHeaders(new Headers({ Accept: "application/json", Traceparent: STALE }));

    expect(Object.keys(headers).sort()).toEqual(["accept", "traceparent"]);
    expect(headers.traceparent).toMatch(TRACEPARENT);
    expect(headers.traceparent).not.toBe(STALE);
  });

  it("accepts an array of pairs, keeps the first spelling of a name, joins a repeated name and replaces a stale traceparent", () => {
    const pairs: HeadersInput = [
      ["Accept", "application/json"],
      ["accept", "application/problem+json"],
      ["TraceParent", STALE],
      ["content-type", "application/json"],
    ];

    const { traceparent, ...others } = injectTraceHeaders(pairs);

    expect(others).toEqual({ Accept: "application/json, application/problem+json", "content-type": "application/json" });
    expect(traceparent).toMatch(TRACEPARENT);
  });

  it.each([
    ["a Headers object", (): HeadersInput => new Headers({ accept: "application/json", traceparent: STALE })],
    ["an array of pairs", (): HeadersInput => [["accept", "application/json"], ["traceparent", STALE]]],
    ["a record", (): HeadersInput => ({ accept: "application/json", traceparent: STALE })],
  ])("replaces the stale traceparent of %s with the page's, in the page's trace, and adds no other header", (_shape, input) => {
    const { traceparent, ...others } = injectTraceHeaders(input());

    expect(others).toEqual({ accept: "application/json" });
    expect(partsOf(traceparent).traceId).toBe(pageTraceId());
    expect(traceparent).not.toBe(STALE);
  });

  it("replaces a traceparent already present, whatever its case, and keeps the other headers", () => {
    const headers = injectTraceHeaders({ Traceparent: STALE, "content-type": "application/json" });

    expect(Object.keys(headers).sort()).toEqual(["content-type", "traceparent"]);
    expect(headers.traceparent).toMatch(TRACEPARENT);
  });

  it("returns a plain record for every input and never the input itself", () => {
    const record = { accept: "application/json" };

    expect(injectTraceHeaders(record)).not.toBe(record);
    expect(Object.keys(injectTraceHeaders([]))).toEqual(["traceparent"]);
    expect(Object.keys(injectTraceHeaders(new Headers()))).toEqual(["traceparent"]);
  });
});

describe("injectTraceHeaders under a fault", () => {
  it("returns the headers without a traceparent, and counts one internal span drop, when the random source throws", async () => {
    const next = await freshPage();
    const recorded = installFaultyMeter();
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => {
      throw new Error("random unavailable");
    });

    const injected = next.injectTraceHeaders({ accept: "application/json", Traceparent: STALE });

    expect(injected).toEqual({ accept: "application/json" });
    expect(internalDropsOf(recorded)).toEqual(["span"]);
  });

  it("returns the headers without a traceparent where there is no crypto at all", async () => {
    const next = await freshPage();
    vi.stubGlobal("crypto", undefined);

    expect(next.injectTraceHeaders({ accept: "application/json" })).toEqual({ accept: "application/json" });
    expect(next.pageTraceparent()).toBeUndefined();
  });
});
