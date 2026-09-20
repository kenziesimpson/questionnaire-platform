import { createEventQueue, routeLogsToQueue, type QueuedEvent } from "@qp/telemetry/browser";
import { afterEach, describe, expect, it } from "vitest";
import { reportAbandonment, watchAbandonment, type SessionProgress } from "../../src/telemetry/abandonment";
import { SESSION_ID, STALE_SESSION_ID } from "../fixtures";

const removers: (() => void)[] = [];

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
});

function routed() {
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
  return { queue, sent };
}

function watching(progress: () => SessionProgress | undefined) {
  removers.push(watchAbandonment(progress));
}

describe("reportAbandonment", () => {
  it("emits session.abandoned with the session id and the last item, as a domain event the wire names", () => {
    const { queue, sent } = routed();
    watching(() => ({ sessionId: SESSION_ID, lastItemId: "itm_03" }));

    reportAbandonment();
    queue.flush();

    expect(sent).toEqual([
      {
        level: "info",
        at: expect.any(String),
        event: "session.abandoned",
        message: "session.abandoned",
        attributes: { "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_03", module: "events" },
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
    watching(() => ({ sessionId: SESSION_ID, lastItemId: null }));

    reportAbandonment();
    reportAbandonment();
    reportAbandonment();
    queue.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.attributes).not.toHaveProperty("questionnaire.last_item_id");
  });

  it("emits again for a different session", () => {
    const { queue, sent } = routed();
    let current: SessionProgress = { sessionId: SESSION_ID, lastItemId: null };
    watching(() => current);

    reportAbandonment();
    current = { sessionId: STALE_SESSION_ID, lastItemId: "itm_01" };
    reportAbandonment();
    queue.flush();

    expect(sent.map((event) => event.attributes["questionnaire.session_id"])).toEqual([SESSION_ID, STALE_SESSION_ID]);
  });

  it("stops watching a session once its watcher is removed", () => {
    const { queue, sent } = routed();
    const stop = watchAbandonment(() => ({ sessionId: "0f0f0f0f-1b3d-4e8f-a6c5-9d0b1e2f3a4b", lastItemId: null }));

    stop();
    reportAbandonment();
    queue.flush();

    expect(sent).toEqual([]);
  });
});
