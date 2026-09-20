import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserTransport } from "../../../src/api/telemetry-transport";
import { queryKeys } from "../../../src/api/query-keys";
import { routeTemplateOf } from "../../../src/telemetry/screen";
import { QUESTIONNAIRE_ID } from "../../support/builders";
import { renderAppAt } from "../../support/render-app";
import { sessionIdOf } from "../../support/reporting";
import { stubFetch } from "@qp/ui/testing";
import { ANSWER_SENTINEL, INGEST_URL, leakHandler, startedTelemetry } from "../../support/telemetry";

const detailPath = `/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(1)}`;

const stops: (() => void)[] = [];

let blobs: Blob[];

beforeEach(() => {
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
  vi.useRealTimers();
});

function carries(value: unknown): boolean {
  return JSON.stringify(value).toLowerCase().includes(ANSWER_SENTINEL.toLowerCase());
}

describe("the response detail screen never lets a stored answer reach what the telemetry queue is handed or the wire", () => {
  it("keeps the answer out of the queue's inputs (what the SDK's logger and capture hand it, before the queue's own scrub) and out of the sent and beaconed bytes, across a failed refetch, a window error and a rejection", async () => {
    let failing = false;
    const requests = stubFetch(leakHandler(() => failing));
    const { router, queryClient } = renderAppAt(detailPath);
    expect(await screen.findByText(ANSWER_SENTINEL), "the screen must render the planted answer for this test to prove anything").toBeInTheDocument();
    const telemetry = startedTelemetry({ screen: () => routeTemplateOf(router), transport: browserTransport() });
    stops.push(telemetry.stop);
    const queue = telemetry.running()?.queue;
    if (queue === undefined) throw new Error("telemetry did not start");
    const enqueueRecord = vi.spyOn(queue, "enqueueRecord");
    const enqueue = vi.spyOn(queue, "enqueue");

    failing = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: queryKeys.responses.session(QUESTIONNAIRE_ID, sessionIdOf(1)) });
    });
    window.dispatchEvent(new ErrorEvent("error", { error: new TypeError(ANSWER_SENTINEL), message: ANSWER_SENTINEL, filename: `https://example.test${detailPath}` }));
    queue.flush();
    window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error(ANSWER_SENTINEL) }));
    window.dispatchEvent(new Event("pagehide"));

    expect(JSON.stringify(queryClient.getQueryData(queryKeys.responses.session(QUESTIONNAIRE_ID, sessionIdOf(1)))), "the answer must still be cached").toContain(
      ANSWER_SENTINEL,
    );
    const posted = requests.filter((request) => request.method === "POST" && request.url === INGEST_URL);
    const beaconed = await Promise.all(blobs.map((blob) => blob.text()));
    expect(enqueueRecord.mock.calls.length, "the queue must have been handed events for this test to prove anything").toBeGreaterThan(1);
    expect(JSON.stringify(posted.map((request) => request.body))).toContain("client.warn");
    expect(beaconed.join("")).toContain("client.error");
    expect(carries(enqueueRecord.mock.calls)).toBe(false);
    expect(carries(enqueue.mock.calls)).toBe(false);
    expect(carries(posted)).toBe(false);
    expect(carries(beaconed)).toBe(false);
  });

  it("names the screen by its route template in every event, never the URL", async () => {
    const requests = stubFetch(leakHandler());
    const { router } = renderAppAt(`${detailPath}?cursor=abc&version=1`);
    await screen.findByText(ANSWER_SENTINEL);
    const telemetry = startedTelemetry({ screen: () => routeTemplateOf(router), transport: browserTransport() });
    stops.push(telemetry.stop);
    window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("Failed to fetch") }));

    window.dispatchEvent(new Event("pagehide"));

    const body = (await Promise.all(blobs.map((blob) => blob.text()))).join("");
    expect(body).toContain("/questionnaires/$questionnaireId/responses/$sessionId");
    expect(body).not.toContain(sessionIdOf(1));
    expect(body).not.toContain(QUESTIONNAIRE_ID);
    expect(body).not.toContain("cursor");
    expect(requests.some((request) => request.url === INGEST_URL && carries(request.body))).toBe(false);
  });
});
