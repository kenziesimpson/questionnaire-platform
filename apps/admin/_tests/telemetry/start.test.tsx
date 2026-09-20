import type { PageDocument, PageWindow } from "@qp/telemetry/browser";
import { ErrorBoundary } from "@qp/ui/error-boundary";
import { stubFetch } from "@qp/ui/testing";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportQueryFailure } from "../../src/telemetry/report";
import { routeTemplateOf } from "../../src/telemetry/screen";
import { reportRenderError, startAdminTelemetry } from "../../src/telemetry/start";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { renderAppAt } from "../support/render-app";
import { sessionIdOf } from "../support/reporting";
import { ANSWER_SENTINEL, leakHandler, recordingTransport, startedTelemetry } from "../support/telemetry";

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the page a browser hands over", () => {
  it("is a PageWindow, and its document a PageDocument, by assignment", () => {
    const page: PageWindow = window;
    const pageDocument: PageDocument = document;

    expect(page).toBe(window);
    expect(pageDocument).toBe(document);
  });
});

describe("startAdminTelemetry", () => {
  it("stamps each event with the route template of the screen the router shows, never the URL", async () => {
    stubFetch(leakHandler());
    const { router } = renderAppAt(`/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(1)}?version=1&cursor=abc`);
    await screen.findByRole("list");
    const { transport, beaconed } = recordingTransport();
    stops.push(startedTelemetry({ screen: () => routeTemplateOf(router), transport }).stop);

    reportQueryFailure(new TypeError("Failed to fetch"));
    window.dispatchEvent(new Event("pagehide"));

    expect(beaconed).toHaveLength(1);
    expect(beaconed[0]?.attributes["http.route"]).toBe("/questionnaires/$questionnaireId/responses/$sessionId");
    expect(JSON.stringify(beaconed)).not.toContain(QUESTIONNAIRE_ID);
    expect(JSON.stringify(beaconed)).not.toContain(sessionIdOf(1));
    expect(JSON.stringify(beaconed)).not.toContain("cursor");
  });

  it("starts nothing before the first paint has settled, and stops listening when stopped", () => {
    const { transport, beaconed } = recordingTransport();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const telemetry = startAdminTelemetry({ page: window, screen: () => undefined, transport });
    stops.push(telemetry.stop);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(1000);

    expect(telemetry.running()).toBeUndefined();

    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(telemetry.running()).toBeDefined();

    reportQueryFailure(new TypeError("Failed to fetch"));
    telemetry.stop();
    window.dispatchEvent(new Event("pagehide"));

    expect(beaconed).toHaveLength(1);
  });
});

function Boom({ message }: { readonly message: string }): never {
  throw new TypeError(message);
}

describe("the shared error boundary reporting through reportRenderError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("renders the fallback and reports the component error's class, frames and route template, never its message", () => {
    const { transport, beaconed } = recordingTransport();
    stops.push(startedTelemetry({ screen: () => "/questionnaires/$questionnaireId/responses/$sessionId", transport }).stop);

    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={reportRenderError}>
        <Boom message={ANSWER_SENTINEL} />
      </ErrorBoundary>,
    );
    window.dispatchEvent(new Event("pagehide"));

    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(beaconed).toHaveLength(1);
    expect(beaconed[0]).toMatchObject({
      level: "error",
      message: "render error",
      attributes: { "error.type": "TypeError", "http.route": "/questionnaires/$questionnaireId/responses/$sessionId" },
    });
    expect(beaconed[0]?.attributes["error.stack"]).toMatch(/^ {4}at /);
    expect(JSON.stringify(beaconed)).not.toContain(ANSWER_SENTINEL);
  });

  it("still renders the fallback when telemetry has not started", () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={reportRenderError}>
        <Boom message={ANSWER_SENTINEL} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("fallback")).toBeInTheDocument();
  });
});
