import { executionApi } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { FakeServer, jsonReply, networkFailure, urlOf } from "@qp/ui/testing";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app";
import { browserTransport } from "../../src/api/telemetry-transport";
import { partialsKey } from "../../src/storage/partials";
import { startRespondentTelemetry } from "../../src/telemetry/start";
import { ANSWER_SENTINEL, inProgressSession, intakeV1, SESSION_ID } from "../fixtures";

const intakePath = `/q/${INTAKE_QUESTIONNAIRE_ID}`;
const sessionsUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.createSession);
const sessionUrl = urlOf(executionApi.EXECUTION_PREFIX, executionApi.getSession, { params: { sessionId: SESSION_ID } });
const ingestUrl = "/api/telemetry";

const BATCH_SIZE = 20;

const stops: (() => void)[] = [];

let server: FakeServer;
let blobs: Blob[];

beforeEach(() => {
  server = new FakeServer().install();
  blobs = [];
  Object.defineProperty(window.navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: (_url: string, data: Blob) => {
      blobs.push(data);
      return true;
    },
  });
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  Reflect.deleteProperty(window.navigator, "sendBeacon");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function carries(value: unknown): boolean {
  return JSON.stringify(value).toLowerCase().includes(ANSWER_SENTINEL.toLowerCase());
}

function startTelemetry(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  stops.push(
    startRespondentTelemetry({
      page: window,
      performance: { getEntriesByType: () => [{ duration: 900 }] },
      pathname: intakePath,
      transport: browserTransport(),
    }),
  );
  window.dispatchEvent(new Event("load"));
  vi.advanceTimersByTime(2000);
  vi.useRealTimers();
}

function renderApp() {
  return render(
    <StrictMode>
      <App pathname={intakePath} />
    </StrictMode>,
  );
}

const pharmacy = () => screen.getByLabelText("Preferred pharmacy", { exact: false });

describe("the respondent's telemetry never carries an answer", () => {
  it("keeps a typed answer, an error and a rejection carrying it, and a resumed session's stored answers out of the sent batches and the beacon", async () => {
    const user = userEvent.setup();
    server.on("POST", ingestUrl, jsonReply(202, { accepted: 1, dropped: 0 }));
    server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    startTelemetry();
    const first = renderApp();
    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
    await user.type(pharmacy(), ANSWER_SENTINEL);
    expect(localStorage.getItem(partialsKey(INTAKE_QUESTIONNAIRE_ID)), "the answer must be stored for this test to prove anything").toContain(ANSWER_SENTINEL);
    first.unmount();
    server.on("GET", sessionUrl, networkFailure());
    renderApp();
    await screen.findByRole("alert");

    for (let count = 0; count < BATCH_SIZE; count += 1) {
      window.dispatchEvent(
        new ErrorEvent("error", { error: new TypeError(ANSWER_SENTINEL), message: ANSWER_SENTINEL, filename: `https://example.test/q/${ANSWER_SENTINEL}` }),
      );
    }
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error(ANSWER_SENTINEL) }));
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: ANSWER_SENTINEL }));
    window.dispatchEvent(new ErrorEvent("error", { error: new RangeError(ANSWER_SENTINEL) }));
    window.dispatchEvent(new Event("pagehide"));

    const posted = server.sent("POST", ingestUrl);
    const beaconed = await Promise.all(blobs.map((blob) => blob.text()));
    expect(posted.length, "the batch must have been sent for this test to prove anything").toBeGreaterThan(0);
    expect(JSON.stringify(posted.map((request) => request.body))).toContain("client.error");
    expect(beaconed.join(""), "the beacon must have been used for this test to prove anything").toContain("client.error");
    expect(carries(posted)).toBe(false);
    expect(carries(beaconed)).toBe(false);
  });

  it("names the abandoned session by its id and last item, and nothing typed, in the bytes the beacon sends", async () => {
    const user = userEvent.setup();
    server.on("POST", sessionsUrl, jsonReply(201, { session: inProgressSession, definition: intakeV1 }));
    startTelemetry();
    renderApp();
    await screen.findByRole("heading", { level: 1, name: "Patient Intake" });
    await user.type(pharmacy(), ANSWER_SENTINEL);

    window.dispatchEvent(new Event("pagehide"));

    const bodies = await Promise.all(blobs.map((blob) => blob.text()));
    const joined = bodies.join("");
    expect(bodies.length, "the beacon must have been used for this test to prove anything").toBeGreaterThan(0);
    expect(joined).toContain(SESSION_ID);
    expect(joined).toContain("session.abandoned");
    expect(joined).toContain("itm_04");
    const abandonment = bodies
      .flatMap((body) => (JSON.parse(body) as { events: { name: string; fields?: object }[] }).events)
      .find((event) => event.name === "session.abandoned");
    expect(Object.keys(abandonment?.fields ?? {}).sort()).toEqual(["lastItemId", "sessionId"]);
    expect(carries(bodies)).toBe(false);
  });
});
