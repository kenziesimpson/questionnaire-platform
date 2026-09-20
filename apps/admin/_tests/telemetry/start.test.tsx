import { reportingApi } from "@qp/shared";
import type { PageDocument, PageWindow } from "@qp/telemetry/browser";
import { contractResponse, jsonResponse, stubFetch, type Reply } from "@qp/ui/testing";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportQueryFailure } from "../../src/telemetry/report";
import { routeTemplateOf } from "../../src/telemetry/screen";
import { startAdminTelemetry } from "../../src/telemetry/start";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { renderAppAt } from "../support/render-app";
import { aSessionDetail, aSessionPage, aSessionSummary, sessionIdOf } from "../support/reporting";
import { recordingTransport, startedTelemetry } from "../support/telemetry";
import { LIST_URL, VERSIONS_URL, sessionUrl } from "../support/routes";

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

const handler: Reply = ({ url }) => {
  if (url === LIST_URL) return jsonResponse(200, []);
  if (url === VERSIONS_URL) return jsonResponse(200, []);
  if (url.split("?")[0]?.endsWith("/responses")) return contractResponse(reportingApi.listSessions, 200, aSessionPage([aSessionSummary(1)]));
  if (url === sessionUrl(sessionIdOf(1))) return contractResponse(reportingApi.getSessionDetail, 200, aSessionDetail(1));
  throw new Error(`unexpected request to ${url}`);
};

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
    stubFetch(handler);
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
