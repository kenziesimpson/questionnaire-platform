import { stubFetch } from "@qp/ui/testing";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserTransport } from "../../../src/api/telemetry-transport";
import { routeTemplateOf } from "../../../src/telemetry/screen";
import { QUESTIONNAIRE_ID } from "../../support/builders";
import { renderAppAt } from "../../support/render-app";
import { sessionIdOf } from "../../support/reporting";
import { ANSWER_SENTINEL, leakHandler, startedTelemetry } from "../../support/telemetry";

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

describe("a component error on the response detail screen, whose message carries the stored answer", () => {
  it("shows a fallback without the message, and reports the error's class, frames and the route template, and nothing of the answer", async () => {
    stubFetch(leakHandler());
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
