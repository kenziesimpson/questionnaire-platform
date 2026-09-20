import { reportingApi, type SessionDetail } from "@qp/shared";
import { INTAKE_ITEM_IDS } from "@qp/shared/demo";
import { contractResponse, jsonResponse, problemResponse, stubFetch, type Reply } from "@qp/ui/testing";
import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserTransport } from "../../../src/api/telemetry-transport";
import { queryKeys } from "../../../src/api/query-keys";
import { routeTemplateOf } from "../../../src/telemetry/screen";
import { QUESTIONNAIRE_ID } from "../../support/builders";
import { renderAppAt } from "../../support/render-app";
import { aSessionDetail, aSessionPage, aSessionSummary, sessionIdOf } from "../../support/reporting";
import { LIST_URL, VERSIONS_URL, sessionUrl } from "../../support/routes";
import { startedTelemetry } from "../../support/telemetry";

const ANSWER_SENTINEL = "SENTINEL-answer-value-9c4d";

const INGEST_URL = "/api/telemetry";

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

function plantedDetail(): SessionDetail {
  const detail = aSessionDetail(1);
  return {
    ...detail,
    items: detail.items.map((item) =>
      item.itemId === INTAKE_ITEM_IDS.pharmacy && item.answer?.type === "text" ? { ...item, answer: { ...item.answer, text: ANSWER_SENTINEL } } : item,
    ),
  };
}

describe("the response detail screen never lets a stored answer reach the telemetry wrapper or the wire", () => {
  it("keeps the answer out of what the wrapper is handed and out of the sent and beaconed bytes, across a failed refetch, a window error and a rejection", async () => {
    let failing = false;
    const handler: Reply = ({ url }) => {
      if (url === INGEST_URL) return jsonResponse(202, { accepted: 1, dropped: 0 });
      if (url === LIST_URL || url === VERSIONS_URL) return jsonResponse(200, []);
      if (url.split("?")[0]?.endsWith("/responses")) return contractResponse(reportingApi.listSessions, 200, aSessionPage([aSessionSummary(1)]));
      if (url === sessionUrl(sessionIdOf(1))) {
        return failing ? problemResponse("internal", { detail: ANSWER_SENTINEL }) : contractResponse(reportingApi.getSessionDetail, 200, plantedDetail());
      }
      throw new Error(`unexpected request to ${url}`);
    };
    const requests = stubFetch(handler);
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
    expect(enqueueRecord.mock.calls.length, "the wrapper must have been handed events for this test to prove anything").toBeGreaterThan(1);
    expect(JSON.stringify(posted.map((request) => request.body))).toContain("client.warn");
    expect(beaconed.join("")).toContain("client.error");
    expect(carries(enqueueRecord.mock.calls)).toBe(false);
    expect(carries(enqueue.mock.calls)).toBe(false);
    expect(carries(posted)).toBe(false);
    expect(carries(beaconed)).toBe(false);
  });

  it("names the screen by its route template in every event, never the URL", async () => {
    const requests = stubFetch(({ url }) => {
      if (url === INGEST_URL) return jsonResponse(202, { accepted: 1, dropped: 0 });
      if (url === LIST_URL || url === VERSIONS_URL) return jsonResponse(200, []);
      if (url.split("?")[0]?.endsWith("/responses")) return contractResponse(reportingApi.listSessions, 200, aSessionPage([aSessionSummary(1)]));
      if (url === sessionUrl(sessionIdOf(1))) return contractResponse(reportingApi.getSessionDetail, 200, plantedDetail());
      throw new Error(`unexpected request to ${url}`);
    });
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
