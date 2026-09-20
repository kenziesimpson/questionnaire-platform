import { describe, expect, it } from "vitest";
import { FIELDS, isFieldName } from "../src/fields.js";
import { clientLogEventOf, CLIENT_LOG_LEVELS } from "../src/vocabulary.js";
import {
  BROWSER_DOMAIN_EVENTS,
  browserDomainEventOf,
  browserFieldsOf,
  judgeBrowserField,
  keepsFromBrowser,
  type BrowserEventName,
} from "../src/wire-contract.js";

const NAMES: readonly BrowserEventName[] = [...CLIENT_LOG_LEVELS.map(clientLogEventOf), ...BROWSER_DOMAIN_EVENTS];

const SESSION = "5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d";

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

  it("lets session.abandoned carry exactly what emitDomainEvent's payload for it carries: the session and the last item", () => {
    expect(browserFieldsOf("session.abandoned")).toEqual(["sessionId", "lastItemId"]);
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

describe("browserDomainEventOf", () => {
  it("recognises session.abandoned as the browser domain event, and no other name, of any type", () => {
    expect(browserDomainEventOf("session.abandoned")).toBe("session.abandoned");
    for (const other of ["session.item_skipped", "client.info", "", undefined, null, 7, {}]) {
      expect(browserDomainEventOf(other)).toBeUndefined();
    }
  });
});

describe("judgeBrowserField and keepsFromBrowser: the one gate for a field", () => {
  it("keeps a field on the event's list whose value the registry accepts, and names it", () => {
    expect(judgeBrowserField("client.warn", "sessionId", SESSION)).toBe("sessionId");
    expect(keepsFromBrowser("client.warn", "sessionId", SESSION)).toBe(true);
  });

  it("refuses a field that is not on the event's list as unknown, whatever its value", () => {
    expect(judgeBrowserField("client.info", "elapsedSeconds", 12)).toBe("unknown_field");
    expect(judgeBrowserField("session.abandoned", "route", "/run/x")).toBe("unknown_field");
    expect(judgeBrowserField("client.info", "answer", "yes")).toBe("unknown_field");
    expect(judgeBrowserField("client.info", "__proto__", {})).toBe("unknown_field");
    expect(keepsFromBrowser("client.info", "elapsedSeconds", 12)).toBe(false);
  });

  it("refuses a listed field whose value fails its check as invalid", () => {
    expect(judgeBrowserField("client.info", "sessionId", "nope")).toBe("invalid_field");
    expect(judgeBrowserField("client.info", "method", "TRACE")).toBe("invalid_field");
    expect(keepsFromBrowser("client.info", "sessionId", "nope")).toBe(false);
  });

  it("refuses every field of an event that is not on the allowlist", () => {
    expect(judgeBrowserField("session.completed", "sessionId", SESSION)).toBe("unknown_field");
  });

  it("holds the stack to the strict browser shape, which the registry's lax check does not apply", () => {
    const serverFrame = "    at render (/srv/app/index.js:1:2)";

    expect(FIELDS.errorStack.accepts(serverFrame)).toBe(true);
    expect(judgeBrowserField("client.error", "errorStack", serverFrame)).toBe("invalid_field");
    expect(judgeBrowserField("client.error", "errorStack", "    at render (index.js:1:2)")).toBe("errorStack");
  });
});
