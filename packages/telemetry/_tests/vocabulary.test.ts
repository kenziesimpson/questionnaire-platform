import { describe, expect, it } from "vitest";
import { BROWSER_MESSAGE_SHAPE, clientLogEventOf, clientLogLevelOf, CLIENT_LOG_LEVELS, LOG_MESSAGE_SHAPE } from "../src/vocabulary.js";

describe("the client log names", () => {
  it("has one event name per level, formed from the level", () => {
    expect(CLIENT_LOG_LEVELS.map(clientLogEventOf)).toEqual(["client.info", "client.warn", "client.error"]);
  });

  it.each(CLIENT_LOG_LEVELS)("reads the level %s back from its event name", (level) => {
    expect(clientLogLevelOf(clientLogEventOf(level))).toBe(level);
  });

  it("does not build an event name for a level the client log excludes", () => {
    // @ts-expect-error — debug is not a client log level, so it has no client log event
    const name = clientLogEventOf("debug");

    expect(clientLogLevelOf(name)).toBeUndefined();
  });

  it.each(["session.abandoned", "client.debug", "client", "info", "", undefined, null, 7, {}])("reads no level from %j", (name) => {
    expect(clientLogLevelOf(name)).toBeUndefined();
  });
});

const ASCII = Array.from({ length: 256 }, (_, code) => String.fromCharCode(code));

const LENGTH_LIMIT = 200;

function sampleMessages(): string[] {
  const singles = ASCII;
  const seconds = ASCII.map((character) => `a${character}`);
  const lengths = Array.from({ length: LENGTH_LIMIT }, (_, length) => "a".repeat(length));
  const punctuated = ASCII.map((character) => `session${character}abandoned`);
  const upper = ASCII.map((character) => `${character}bc`);
  return [...singles, ...seconds, ...lengths, ...punctuated, ...upper, "session.abandoned", "page.loaded", "render error", "unhandled rejection"];
}

describe("the log message shapes", () => {
  it("keeps the export shape the Collector's filter carries, character for character", () => {
    expect(LOG_MESSAGE_SHAPE.source.replaceAll("\\/", "/")).toBe("^[A-Za-z][A-Za-z0-9 ._:,/-]{0,127}$");
  });

  it("keeps the browser shape the queue enforced before it was derived", () => {
    expect(BROWSER_MESSAGE_SHAPE.source.replaceAll("\\/", "/")).toBe("^[a-z][a-z0-9 ._:-]{0,79}$");
  });

  it("is a subset: every message the browser accepts, the export accepts", () => {
    const accepted = sampleMessages().filter((message) => BROWSER_MESSAGE_SHAPE.test(message));

    expect(accepted.length).toBeGreaterThan(80);
    for (const message of accepted) expect(LOG_MESSAGE_SHAPE.test(message), JSON.stringify(message)).toBe(true);
  });

  it("is strictly narrower: the export accepts messages the browser refuses", () => {
    const refused = sampleMessages().filter((message) => LOG_MESSAGE_SHAPE.test(message) && !BROWSER_MESSAGE_SHAPE.test(message));

    expect(refused).toEqual(expect.arrayContaining(["A", "a,", "a/", "a".repeat(100)]));
  });
});
