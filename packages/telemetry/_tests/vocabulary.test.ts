import { describe, expect, it } from "vitest";
import { clientLogEventOf, clientLogLevelOf, CLIENT_LOG_LEVELS } from "../src/vocabulary.js";

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
