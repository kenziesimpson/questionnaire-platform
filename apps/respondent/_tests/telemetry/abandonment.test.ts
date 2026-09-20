import { createEventQueue, routeLogsToQueue, type QueuedEvent } from "@qp/telemetry/browser";
import { afterEach, describe, expect, it } from "vitest";
import { reportAbandonment, watchAbandonment, type SessionProgress } from "../../src/telemetry/abandonment";
import { STAMPED_TRACEPARENT } from "../fixtures";

const removers: (() => void)[] = [];

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
});

function sessionIdOf(n: number): string {
  return `${n.toString(16).padStart(8, "0")}-1b3d-4e8f-a6c5-9d0b1e2f3a4b`;
}

function routed() {
  const sent: QueuedEvent[] = [];
  const queue = createEventQueue({
    send: (events) => {
      sent.push(...events);
    },
    beacon: () => true,
    batchSize: 500,
    maxPending: 500,
  });
  removers.push(routeLogsToQueue(queue), () => {
    queue.close();
  });
  return { queue, sent };
}

function watching(progress: () => SessionProgress | undefined) {
  removers.push(watchAbandonment(progress));
}

describe("reportAbandonment", () => {
  it("emits session.abandoned with the session id and the last item, as a domain event the wire names", () => {
    const { queue, sent } = routed();
    watching(() => ({ sessionId: sessionIdOf(1), lastItemId: "itm_03" }));

    reportAbandonment();
    queue.flush();

    expect(sent).toEqual([
      {
        level: "info",
        at: expect.any(String),
        traceparent: STAMPED_TRACEPARENT,
        event: "session.abandoned",
        message: "session.abandoned",
        attributes: { "questionnaire.session_id": sessionIdOf(1), "questionnaire.last_item_id": "itm_03", module: "events" },
      },
    ]);
  });

  it("emits nothing when no session is in progress", () => {
    const { queue, sent } = routed();
    watching(() => undefined);

    reportAbandonment();
    queue.flush();

    expect(sent).toEqual([]);
  });

  it("emits once for a session however many times the page is hidden", () => {
    const { queue, sent } = routed();
    watching(() => ({ sessionId: sessionIdOf(2), lastItemId: null }));

    reportAbandonment();
    reportAbandonment();
    reportAbandonment();
    queue.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.attributes).not.toHaveProperty("questionnaire.last_item_id");
  });

  it("emits once for a session across a watcher that is removed and registered again, as a remount does", () => {
    const { queue, sent } = routed();
    const progress = () => ({ sessionId: sessionIdOf(3), lastItemId: null });
    const stop = watchAbandonment(progress);

    reportAbandonment();
    stop();
    watching(progress);
    reportAbandonment();
    queue.flush();

    expect(sent).toHaveLength(1);
  });

  it("emits again for a different session", () => {
    const { queue, sent } = routed();
    let current: SessionProgress = { sessionId: sessionIdOf(4), lastItemId: null };
    watching(() => current);

    reportAbandonment();
    current = { sessionId: sessionIdOf(5), lastItemId: "itm_01" };
    reportAbandonment();
    queue.flush();

    expect(sent.map((event) => event.attributes["questionnaire.session_id"])).toEqual([sessionIdOf(4), sessionIdOf(5)]);
  });

  it("stops watching a session once its watcher is removed", () => {
    const { queue, sent } = routed();
    const stop = watchAbandonment(() => ({ sessionId: sessionIdOf(6), lastItemId: null }));

    stop();
    reportAbandonment();
    queue.flush();

    expect(sent).toEqual([]);
  });

  it("remembers a bounded number of sessions, forgetting the oldest first", () => {
    const { queue, sent } = routed();
    let current = 100;
    watching(() => ({ sessionId: sessionIdOf(current), lastItemId: null }));

    for (current = 100; current < 201; current += 1) reportAbandonment();
    current = 100;
    reportAbandonment();
    current = 200;
    reportAbandonment();
    queue.flush();

    expect(sent).toHaveLength(102);
    expect(sent.at(-1)?.attributes["questionnaire.session_id"]).toBe(sessionIdOf(100));
  });
});
