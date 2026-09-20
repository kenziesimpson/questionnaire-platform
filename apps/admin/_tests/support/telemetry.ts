import { PROBLEM_CONTENT_TYPE, problem, reportingApi, type SessionDetail } from "@qp/shared";
import { INTAKE_ITEM_IDS } from "@qp/shared/demo";
import { createEventQueue, routeLogsToQueue, type QueuedEvent, type Transport } from "@qp/telemetry/browser";
import { contractResponse, jsonResponse, type Reply } from "@qp/ui/testing";
import { vi } from "vitest";
import { startAdminTelemetry, type AdminTelemetry } from "../../src/telemetry/start";
import { aSessionDetail, aSessionPage, aSessionSummary, sessionIdOf } from "./reporting";
import { LIST_URL, VERSIONS_URL, sessionUrl } from "./routes";

export const ANSWER_SENTINEL = "SENTINEL-answer-value-9c4d";

export const INGEST_URL = "/api/telemetry";

export function recordingTransport() {
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

export function startedTelemetry(options: { readonly screen: () => string | undefined; readonly transport?: Transport }): AdminTelemetry {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const telemetry = startAdminTelemetry({ page: window, ...options });
  window.dispatchEvent(new Event("load"));
  vi.advanceTimersByTime(2000);
  vi.useRealTimers();
  return telemetry;
}

export function routedQueue() {
  const sent: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      sent.push(...events);
    },
    beacon: () => true,
  });
  const stopRouting = routeLogsToQueue(queue);
  return {
    flush: () => {
      queue.flush();
      return sent;
    },
    stop: () => {
      stopRouting();
      queue.close();
    },
  };
}

export function plantedDetail(): SessionDetail {
  const detail = aSessionDetail(1);
  return {
    ...detail,
    items: detail.items.map((item) =>
      item.itemId === INTAKE_ITEM_IDS.pharmacy && item.answer?.type === "text" ? { ...item, answer: { ...item.answer, text: ANSWER_SENTINEL } } : item,
    ),
  };
}

export function sentinelProblemResponse(): Response {
  const body = { ...problem("internal", { detail: ANSWER_SENTINEL }), title: ANSWER_SENTINEL, instance: `/${ANSWER_SENTINEL}` };
  return new Response(JSON.stringify(body), { status: 500, headers: { "content-type": PROBLEM_CONTENT_TYPE } });
}

export function leakHandler(refetchFails: () => boolean = () => false): Reply {
  return ({ url }) => {
    if (url === INGEST_URL) return jsonResponse(202, { accepted: 1, dropped: 0 });
    if (url === LIST_URL || url === VERSIONS_URL) return jsonResponse(200, []);
    if (url.split("?")[0]?.endsWith("/responses")) return contractResponse(reportingApi.listSessions, 200, aSessionPage([aSessionSummary(1)]));
    if (url === sessionUrl(sessionIdOf(1))) {
      return refetchFails() ? sentinelProblemResponse() : contractResponse(reportingApi.getSessionDetail, 200, plantedDetail());
    }
    throw new Error(`unexpected request to ${url}`);
  };
}
