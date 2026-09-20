import { executionApi } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import type { PageDocument, PageWindow, QueuedEvent, Transport } from "@qp/telemetry/browser";
import { FakeServer, heldReply, jsonReply, urlOf } from "@qp/ui/testing";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app";
import { startRespondentTelemetry } from "../../src/telemetry/start";
import { inProgressSession, intakeV1, receipt, SESSION_ID, STALE_SESSION_ID } from "../fixtures";

const intakePath = `/q/${INTAKE_QUESTIONNAIRE_ID}`;
const sessionsUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.createSession);
const submitUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.submitSession, { params: { sessionId: SESSION_ID } });

const stops: (() => void)[] = [];

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer().install();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function transportWith() {
  const sent: QueuedEvent[] = [];
  const beaconed: QueuedEvent[] = [];
  const transport: Transport = {
    send: (events) => {
      sent.push(...events);
    },
    beacon: (events) => {
      beaconed.push(...events);
      return true;
    },
  };
  return { transport, sent, beaconed };
}

function startedTelemetry(pathname: string, duration = 900) {
  const { transport, sent, beaconed } = transportWith();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  stops.push(startRespondentTelemetry({ page: window, performance: { getEntriesByType: () => [{ duration }] }, pathname, transport }));
  window.dispatchEvent(new Event("load"));
  vi.advanceTimersByTime(2000);
  vi.useRealTimers();
  return { sent, beaconed };
}

function abandonmentsIn(events: readonly QueuedEvent[]): QueuedEvent[] {
  return events.filter((event) => event.event === "session.abandoned");
}

function hidePage(): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderApp() {
  return render(
    <StrictMode>
      <App pathname={intakePath} />
    </StrictMode>,
  );
}

const pharmacy = () => screen.getByLabelText("Preferred pharmacy", { exact: false });

describe("the page a browser hands over", () => {
  it("is a PageWindow, and its document a PageDocument, by assignment", () => {
    const page: PageWindow = window;
    const pageDocument: PageDocument = document;

    expect(page).toBe(window);
    expect(pageDocument).toBe(document);
  });
});

describe("startRespondentTelemetry: page speed", () => {
  it("beacons page.loaded with the route template and the load duration when the page is hidden", () => {
    const { beaconed } = startedTelemetry(intakePath, 1234.4);

    window.dispatchEvent(new Event("pagehide"));

    expect(beaconed).toEqual([
      {
        level: "info",
        at: expect.any(String),
        event: "page.loaded",
        message: "page.loaded",
        attributes: { "http.route": "/q/:questionnaireId", "questionnaire.duration_ms": 1234, module: "events" },
      },
    ]);
  });

  it("reports no page load, and stamps no route, for a path that is not a questionnaire", () => {
    const { beaconed } = startedTelemetry("/nowhere");

    window.dispatchEvent(new Event("pagehide"));

    expect(beaconed).toEqual([]);
  });

  it("does not let a performance entry that cannot be read surface, and still reports what the page hands over afterwards", () => {
    const { transport, beaconed } = transportWith();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stops.push(
      startRespondentTelemetry({
        page: window,
        performance: {
          getEntriesByType: () => {
            throw new Error("performance unavailable");
          },
        },
        pathname: intakePath,
        transport,
      }),
    );
    window.dispatchEvent(new Event("load"));

    expect(() => {
      vi.advanceTimersByTime(2000);
    }).not.toThrow();
    vi.useRealTimers();
    window.dispatchEvent(new Event("pagehide"));

    expect(beaconed).toEqual([]);
  });

  it("starts nothing before the first paint has settled", () => {
    const { transport, beaconed } = transportWith();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stops.push(startRespondentTelemetry({ page: window, performance: { getEntriesByType: () => [{ duration: 900 }] }, pathname: intakePath, transport }));
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("pagehide"));
    vi.useRealTimers();

    expect(beaconed).toEqual([]);
  });

  it("stops listening when stopped", () => {
    const { beaconed } = startedTelemetry(intakePath);
    stops.pop()?.();
    const handedOver = beaconed.length;

    window.dispatchEvent(new Event("pagehide"));

    expect(beaconed).toHaveLength(handedOver);
  });
});

describe("startRespondentTelemetry: the abandonment beacon", () => {
  it("beacons session.abandoned with the session id and the last item the respondent touched, when the page is hidden mid-session, and no answer", async () => {
    const user = userEvent.setup();
    server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    const { beaconed } = startedTelemetry(intakePath);
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
    await user.type(pharmacy(), "Corner pharmacy");

    hidePage();

    expect(abandonmentsIn(beaconed)).toEqual([
      {
        level: "info",
        at: expect.any(String),
        event: "session.abandoned",
        message: "session.abandoned",
        attributes: { "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_04", "http.route": "/q/:questionnaireId", module: "events" },
      },
    ]);
    expect(JSON.stringify(beaconed)).not.toContain("Corner pharmacy");
  });

  it("beacons it on pagehide as well, and once however many times the page is hidden", async () => {
    server.on("POST", sessionsUrl, jsonReply(201, { session: { ...inProgressSession, sessionId: STALE_SESSION_ID }, definition: intakeV1 }));
    const { beaconed } = startedTelemetry(intakePath);
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });

    hidePage();
    window.dispatchEvent(new Event("pagehide"));
    hidePage();

    expect(abandonmentsIn(beaconed)).toHaveLength(1);
    expect(abandonmentsIn(beaconed)[0]?.attributes).not.toHaveProperty("questionnaire.last_item_id");
  });

  it("beacons nothing for a session that is still being created", () => {
    const held = heldReply();
    server.on("POST", sessionsUrl, held.reply);
    const { beaconed } = startedTelemetry(intakePath);
    renderApp();

    window.dispatchEvent(new Event("pagehide"));

    expect(screen.getByRole("status")).toHaveTextContent("Loading questionnaire");
    expect(abandonmentsIn(beaconed)).toEqual([]);
  });

  it("beacons nothing once the answers were submitted", async () => {
    const user = userEvent.setup();
    server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    server.on("POST", submitUrl, jsonReply(200, { receipt }));
    const { beaconed } = startedTelemetry(intakePath);
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
    await user.click(within(screen.getByRole("radiogroup", { name: /Do you have a medical condition\?/ })).getByRole("radio", { name: "No" }));
    await user.type(pharmacy(), "Corner pharmacy");
    await user.click(screen.getByRole("button", { name: /Submit/ }));
    await screen.findByRole("heading", { level: 1, name: "Your answers were submitted" });

    window.dispatchEvent(new Event("pagehide"));

    expect(abandonmentsIn(beaconed)).toEqual([]);
  });
});
