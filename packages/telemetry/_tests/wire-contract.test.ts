import { describe, expect, it } from "vitest";
import { FIELDS, isFieldName } from "../src/fields.js";
import { CLIENT_LOG_EVENTS } from "../src/vocabulary.js";
import {
  acceptsFromBrowser,
  BROWSER_DOMAIN_EVENTS,
  browserDomainEventOf,
  browserFieldsOf,
  isClientLogEvent,
  type BrowserEventName,
} from "../src/wire-contract.js";

const NAMES: readonly BrowserEventName[] = [...CLIENT_LOG_EVENTS, ...BROWSER_DOMAIN_EVENTS];

describe("browserFieldsOf", () => {
  it.each(NAMES)("lists only registry fields for %s", (name) => {
    const fields = browserFieldsOf(name) ?? [];

    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every(isFieldName)).toBe(true);
  });

  it("lets the three client log events carry the same fields", () => {
    expect(browserFieldsOf("client.warn")).toEqual(browserFieldsOf("client.info"));
    expect(browserFieldsOf("client.error")).toEqual(browserFieldsOf("client.info"));
  });

  it("lets session.abandoned carry its session, its last item and its measures, and no route or error", () => {
    expect(browserFieldsOf("session.abandoned")).toEqual(
      expect.arrayContaining(["sessionId", "questionnaireId", "questionnaireVersion", "lastItemId", "elapsedSeconds", "questionCount"]),
    );
    expect(browserFieldsOf("session.abandoned")).not.toContain("route");
    expect(browserFieldsOf("session.abandoned")).not.toContain("errorStack");
  });

  it("never lets a browser event carry a field the server alone stamps or measures", () => {
    for (const name of NAMES) {
      const fields = browserFieldsOf(name) ?? [];
      for (const serverOnly of ["source", "eventAgeMs", "outcome", "durationMs", "status", "requestId", "problem"] as const) {
        expect(fields).not.toContain(serverOnly);
      }
    }
  });

  it.each(["session.item_skipped", "session.completed", "questionnaire.created", "client.debug", "", "__proto__", "toString"])(
    "knows no event named %j",
    (name) => {
      expect(browserFieldsOf(name)).toBeUndefined();
    },
  );
});

describe("the closed names", () => {
  it.each(CLIENT_LOG_EVENTS)("recognises %s as a client log event", (name) => {
    expect(isClientLogEvent(name)).toBe(true);
  });

  it.each(["session.abandoned", "client.debug", "client", ""])("does not recognise %j as a client log event", (name) => {
    expect(isClientLogEvent(name)).toBe(false);
  });

  it("recognises session.abandoned as the browser domain event, and no other name, of any type", () => {
    expect(browserDomainEventOf("session.abandoned")).toBe("session.abandoned");
    for (const other of ["session.item_skipped", "client.info", "", undefined, null, 7, {}]) {
      expect(browserDomainEventOf(other)).toBeUndefined();
    }
  });
});

describe("acceptsFromBrowser", () => {
  it("defers to the registry's own check for every field but the stack", () => {
    expect(acceptsFromBrowser("sessionId", "5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d")).toBe(FIELDS.sessionId.accepts("5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d"));
    expect(acceptsFromBrowser("sessionId", "nope")).toBe(false);
    expect(acceptsFromBrowser("elapsedSeconds", 12)).toBe(true);
  });

  it("holds the stack to the strict browser shape, which the registry's lax check does not", () => {
    const serverFrame = "    at render (/srv/app/index.js:1:2)";

    expect(FIELDS.errorStack.accepts(serverFrame)).toBe(true);
    expect(acceptsFromBrowser("errorStack", serverFrame)).toBe(false);
    expect(acceptsFromBrowser("errorStack", "    at render (index.js:1:2)")).toBe(true);
  });
});
