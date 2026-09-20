import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryErrorBoundary } from "../../src/telemetry/error-boundary";
import { recordingTransport, startedTelemetry } from "../support/telemetry";

const ANSWER_SENTINEL = "SENTINEL-answer-value-9c4d";

const stops: (() => void)[] = [];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Boom({ message }: { readonly message: string }): never {
  throw new TypeError(message);
}

describe("TelemetryErrorBoundary", () => {
  it("renders its children while nothing throws", () => {
    render(
      <TelemetryErrorBoundary fallback={<p>fallback</p>}>
        <p>children</p>
      </TelemetryErrorBoundary>,
    );

    expect(screen.getByText("children")).toBeInTheDocument();
  });

  it("renders the fallback and reports the component error's class and stack frames, never its message", () => {
    const { transport, beaconed } = recordingTransport();
    stops.push(startedTelemetry({ screen: () => "/questionnaires/$questionnaireId/responses/$sessionId", transport }).stop);

    render(
      <TelemetryErrorBoundary fallback={<p>fallback</p>}>
        <Boom message={ANSWER_SENTINEL} />
      </TelemetryErrorBoundary>,
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
      <TelemetryErrorBoundary fallback={<p>fallback</p>}>
        <Boom message={ANSWER_SENTINEL} />
      </TelemetryErrorBoundary>,
    );

    expect(screen.getByText("fallback")).toBeInTheDocument();
  });
});
