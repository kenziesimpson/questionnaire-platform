import { createEventQueue, routeLogsToQueue, type QueuedEvent } from "@qp/telemetry/browser";
import { afterEach, describe, expect, it } from "vitest";
import { reportPageLoad, type PagePerformance } from "../../src/telemetry/page-speed";

const ROUTE = "/q/:questionnaireId";

const removers: (() => void)[] = [];

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
});

function reportedWith(performance: PagePerformance): QueuedEvent[] {
  const sent: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      sent.push(...events);
    },
    beacon: () => true,
  });
  removers.push(routeLogsToQueue(queue), () => {
    queue.close();
  });
  reportPageLoad(performance, ROUTE);
  queue.flush();
  return sent;
}

function performanceWith(...durations: number[]): PagePerformance {
  return { getEntriesByType: () => durations.map((duration) => ({ duration })) };
}

describe("reportPageLoad", () => {
  it("emits page.loaded with the route template and the navigation's duration in whole milliseconds", () => {
    const sent = reportedWith(performanceWith(1234.6));

    expect(sent).toEqual([
      {
        level: "info",
        at: expect.any(String),
        event: "page.loaded",
        message: "page.loaded",
        attributes: { "http.route": ROUTE, "questionnaire.duration_ms": 1235, module: "events" },
      },
    ]);
  });

  it.each([
    ["no navigation entry", performanceWith()],
    ["a navigation that has not finished loading, whose duration is 0", performanceWith(0)],
    ["a duration that is not a number", performanceWith(Number.NaN)],
    ["a negative duration", performanceWith(-5)],
  ])("emits nothing for %s", (_case, performance) => {
    expect(reportedWith(performance)).toEqual([]);
  });

  it("reads the first navigation entry only", () => {
    const sent = reportedWith(performanceWith(900, 5000));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.attributes["questionnaire.duration_ms"]).toBe(900);
  });
});
