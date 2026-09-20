import { afterFirstPaint, captureError, startBrowserTelemetry, type BrowserTelemetry, type PageWindow, type Transport } from "@qp/telemetry/browser";
import { browserTransport } from "../api/telemetry-transport";
import { questionnaireIdFromPath } from "../entry/questionnaire-path";
import { reportAbandonment } from "./abandonment";
import { reportPageLoad, type PagePerformance } from "./page-speed";

const RESPONDENT_ROUTE = "/q/:questionnaireId";

interface RespondentTelemetryOptions {
  readonly page: PageWindow;
  readonly performance: PagePerformance;
  readonly pathname: string;
  readonly transport?: Transport;
}

let running: BrowserTelemetry | undefined;

export function reportRenderError(error: unknown): void {
  if (running !== undefined) captureError(running.queue, "render", error);
}

export function startRespondentTelemetry({ page, performance, pathname, transport = browserTransport() }: RespondentTelemetryOptions): () => void {
  const route = questionnaireIdFromPath(pathname) === undefined ? undefined : RESPONDENT_ROUTE;
  let started: BrowserTelemetry | undefined;
  const cancel = afterFirstPaint(() => {
    started = startBrowserTelemetry({ ...transport, page, screen: () => route, beforeExit: reportAbandonment });
    running = started;
    if (route !== undefined) reportPageLoad(performance, route);
  }, page);
  return () => {
    cancel();
    started?.stop();
    if (running === started) running = undefined;
  };
}
