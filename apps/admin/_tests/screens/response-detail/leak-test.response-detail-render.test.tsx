import { reportingApi, type SessionDetail } from "@qp/shared";
import { INTAKE_ITEM_IDS } from "@qp/shared/demo";
import { contractResponse, jsonResponse, stubFetch } from "@qp/ui/testing";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserTransport } from "../../../src/api/telemetry-transport";
import { routeTemplateOf } from "../../../src/telemetry/screen";
import { QUESTIONNAIRE_ID } from "../../support/builders";
import { renderAppAt } from "../../support/render-app";
import { aSessionDetail, aSessionPage, aSessionSummary, sessionIdOf } from "../../support/reporting";
import { LIST_URL, VERSIONS_URL, sessionUrl } from "../../support/routes";
import { startedTelemetry } from "../../support/telemetry";

const ANSWER_SENTINEL = "SENTINEL-answer-value-9c4d";

vi.mock("../../../src/screens/response-detail/answer-display", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AnswerDisplay: ({ answer }: { readonly answer: unknown }) => {
    throw new TypeError(`cannot show ${JSON.stringify(answer)}`);
  },
}));

const stops: (() => void)[] = [];

let blobs: Blob[];

beforeEach(() => {
  blobs = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
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

function plantedDetail(): SessionDetail {
  const detail = aSessionDetail(1);
  return {
    ...detail,
    items: detail.items.map((item) =>
      item.itemId === INTAKE_ITEM_IDS.pharmacy && item.answer?.type === "text" ? { ...item, answer: { ...item.answer, text: ANSWER_SENTINEL } } : item,
    ),
  };
}

describe("a component error on the response detail screen, whose message carries the stored answer", () => {
  it("shows a fallback without the message, and reports the error's class, frames and the route template, and nothing of the answer", async () => {
    stubFetch(({ url }) => {
      if (url === "/api/telemetry") return jsonResponse(202, { accepted: 1, dropped: 0 });
      if (url === LIST_URL || url === VERSIONS_URL) return jsonResponse(200, []);
      if (url.split("?")[0]?.endsWith("/responses")) return contractResponse(reportingApi.listSessions, 200, aSessionPage([aSessionSummary(1)]));
      if (url === sessionUrl(sessionIdOf(1))) return contractResponse(reportingApi.getSessionDetail, 200, plantedDetail());
      throw new Error(`unexpected request to ${url}`);
    });
    const { router } = renderAppAt(`/questionnaires/${QUESTIONNAIRE_ID}/responses/${sessionIdOf(1)}`);
    const telemetry = startedTelemetry({ screen: () => routeTemplateOf(router), transport: browserTransport() });
    stops.push(telemetry.stop);

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    window.dispatchEvent(new Event("pagehide"));

    expect(document.body.textContent).not.toContain(ANSWER_SENTINEL);
    const body = (await Promise.all(blobs.map((blob) => blob.text()))).join("");
    expect(body, "the error must have been reported for this test to prove anything").toContain("client.error");
    expect(body).toContain("TypeError");
    expect(body).toContain("/questionnaires/$questionnaireId/responses/$sessionId");
    expect(body.toLowerCase()).not.toContain(ANSWER_SENTINEL.toLowerCase());
    expect(body).not.toContain("cannot show");
  });
});
