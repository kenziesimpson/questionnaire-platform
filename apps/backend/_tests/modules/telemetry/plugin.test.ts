import { PROBLEM_CONTENT_TYPE, problemType, telemetryApi } from "@qp/shared";
import { installTestTelemetry, type TestTelemetry } from "@qp/telemetry/testing";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trustNearestProxy } from "../../../src/app.js";
import { telemetryModule, type TelemetryModuleOptions } from "../../../src/modules/telemetry/plugin.js";

const LEAK = "LEAK_DIABETES_8F3A";

const AT = "2026-09-19T10:00:00.000Z";

const RECEIVED_AT = Date.parse("2026-09-19T10:00:05.000Z");

const SESSION_ID = "5b1e7c2a-3d4f-4a6b-8c9d-0e1f2a3b4c5d";

const INGEST_URL = telemetryApi.TELEMETRY_PREFIX;

let telemetry: TestTelemetry;
let app: FastifyInstance | undefined;

async function build(options: TelemetryModuleOptions = {}, trustProxy: boolean | typeof trustNearestProxy = false): Promise<FastifyInstance> {
  const instance = Fastify({ trustProxy });
  app = instance;
  await instance.register(telemetryModule, { now: () => RECEIVED_AT, ...options, prefix: telemetryApi.TELEMETRY_PREFIX });
  await instance.ready();
  return instance;
}

function post(instance: FastifyInstance, payload: unknown, url: string = INGEST_URL) {
  return instance.inject({ method: "POST", url, payload: payload as object });
}

beforeEach(() => {
  telemetry = installTestTelemetry();
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
  await telemetry.shutdown();
});

describe("POST /api/telemetry", () => {
  it("answers 202 with the count of events accepted and dropped, uncached, and re-emits each accepted event with the server's stamps", async () => {
    const instance = await build();

    const response = await post(instance, {
      events: [
        { name: "client.error", at: AT, fields: { errorType: "TypeError", status: 500 } },
        { name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID, lastItemId: "itm_02" } },
        { name: "not.allowlisted", at: AT },
      ],
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ accepted: 2, dropped: 1 });
    expect(telemetry.logs()).toMatchObject([
      { msg: "client.error", module: "browser", "error.type": "TypeError", "telemetry.source": "browser", "telemetry.event_age_ms": 5000 },
      { msg: "session.abandoned", module: "events", "questionnaire.session_id": SESSION_ID, "questionnaire.last_item_id": "itm_02" },
    ]);
  });

  it("answers the same at the prefix with a trailing slash, and an empty batch with zero of each", async () => {
    const instance = await build();

    const slashed = await post(instance, { events: [{ name: "client.info", at: AT }] }, `${INGEST_URL}/`);
    const empty = await post(instance, { events: [] });

    expect(slashed.statusCode).toBe(202);
    expect(slashed.json()).toEqual({ accepted: 1, dropped: 0 });
    expect(empty.statusCode).toBe(202);
    expect(empty.json()).toEqual({ accepted: 0, dropped: 0 });
  });

  it("wraps the batch in a telemetry.ingest span, so a client event with no traceparent is logged under a server trace", async () => {
    const instance = await build();

    await post(instance, { events: [{ name: "client.info", at: AT }] });

    const [span] = telemetry.spans();
    expect(span?.name).toBe("telemetry.ingest");
    expect(telemetry.logs()[0]).toMatchObject({ trace_id: span?.spanContext().traceId });
  });

  it.each([
    ["an object with no events", { [LEAK]: LEAK, answer: LEAK }],
    ["events that are not an array", { events: LEAK, answer: LEAK }],
    ["events that are null", { events: null, answer: LEAK }],
    ["a bare array", [{ name: "client.info", at: AT, fields: { text: LEAK } }]],
  ])("answers %s as a 400 request/invalid problem, and logs nothing of the body", async (_name, body) => {
    const instance = await build();

    const response = await post(instance, body);

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({ type: problemType("request/invalid"), status: 400 });
    expect(JSON.stringify(telemetry.logs())).not.toContain(LEAK);
    expect(JSON.stringify(await telemetry.metrics())).not.toContain(LEAK);
  });

  it("answers a body that is not JSON as a 400 problem without logging it", async () => {
    const instance = await build();

    const response = await instance.inject({
      method: "POST",
      url: INGEST_URL,
      headers: { "content-type": "application/json" },
      payload: `{"events": "${LEAK}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: problemType("request/invalid") });
    expect(JSON.stringify(telemetry.logs())).not.toContain(LEAK);
  });

  it("answers a bare-token body whose parse error would quote it as a 400 problem, and exports and logs none of it", async () => {
    const instance = await build();

    const response = await instance.inject({
      method: "POST",
      url: INGEST_URL,
      headers: { "content-type": "application/json" },
      payload: `{"events": ${LEAK}}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(LEAK);
    expect(JSON.stringify(telemetry.logs())).not.toContain(LEAK);
    expect(JSON.stringify(await telemetry.metrics())).not.toContain(LEAK);
  });

  it.each([
    ["a __proto__ key in an event's fields", `{"events":[{"name":"client.info","at":"${AT}","fields":{"__proto__":{"sessionId":"${LEAK}"}}}]}`],
    ["a __proto__ key at the top of the batch", `{"__proto__":{"x":1},"events":[]}`],
    ["a constructor.prototype key", `{"events":[{"name":"client.info","at":"${AT}","fields":{"constructor":{"prototype":{"x":1}}}}]}`],
  ])("answers %s as a 400 problem for the whole batch, and ingests none of it", async (_name, payload) => {
    const instance = await build();

    const response = await instance.inject({ method: "POST", url: INGEST_URL, headers: { "content-type": "application/json" }, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: problemType("request/invalid") });
    expect(telemetry.logs().filter((line) => line.msg === "client.info")).toEqual([]);
    expect(JSON.stringify(telemetry.logs())).not.toContain(LEAK);
  });

  it("refuses a body over the size cap as a 413 that is answered as a 400 request/invalid problem, without logging it", async () => {
    const instance = await build();
    const oversized = { events: [{ name: "client.info", at: AT, fields: { text: `${LEAK}${"x".repeat(telemetryApi.MAX_TELEMETRY_BODY_BYTES)}` } }] };

    const response = await post(instance, oversized);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: problemType("request/invalid") });
    expect(JSON.stringify(telemetry.logs())).not.toContain(LEAK);
  });

  it("refuses a request over the rate limit with 429, a Retry-After and no ingest, and admits again after the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: RECEIVED_AT });
    const instance = await build({ rateLimit: { max: 2, windowMs: 60_000 } });
    const batch = { events: [{ name: "client.info", at: AT }] };

    expect((await post(instance, batch)).statusCode).toBe(202);
    expect((await post(instance, batch)).statusCode).toBe(202);
    vi.setSystemTime(RECEIVED_AT + 20_000);
    const limited = await post(instance, batch);

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("40");
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(limited.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(limited.json()).toMatchObject({ type: problemType("request/rate-limited"), status: 429 });
    expect(telemetry.logs().filter((line) => line.msg === "client.info")).toHaveLength(2);

    vi.setSystemTime(RECEIVED_AT + 60_000);
    expect((await post(instance, batch)).statusCode).toBe(202);
  });

  it("sends no x-ratelimit header, on an admitted request or a refused one", async () => {
    const instance = await build({ rateLimit: { max: 1, windowMs: 60_000 } });
    const batch = { events: [{ name: "client.info", at: AT }] };

    const responses = [await post(instance, batch), await post(instance, batch)];

    expect(responses.map((response) => response.statusCode)).toEqual([202, 429]);
    for (const response of responses) {
      expect(Object.keys(response.headers).filter((name) => name.startsWith("x-ratelimit") || name.startsWith("ratelimit"))).toEqual([]);
    }
  });

  it("counts each address on its own", async () => {
    const instance = await build({ rateLimit: { max: 1, windowMs: 60_000 } });
    const batch = { events: [{ name: "client.info", at: AT }] };
    const from = (remoteAddress: string) => instance.inject({ method: "POST", url: INGEST_URL, remoteAddress, payload: batch });

    const statuses = [
      (await from("203.0.113.5")).statusCode,
      (await from("203.0.113.6")).statusCode,
      (await from("203.0.113.5")).statusCode,
      (await from("203.0.113.6")).statusCode,
    ];

    expect(statuses).toEqual([202, 202, 429, 429]);
  });

  it("shares one bucket across an IPv6 /64, separates other prefixes, and counts an IPv4-mapped address as the IPv4 one", async () => {
    const instance = await build({ rateLimit: { max: 1, windowMs: 60_000 } });
    const batch = { events: [{ name: "client.info", at: AT }] };
    const from = async (remoteAddress: string) => (await instance.inject({ method: "POST", url: INGEST_URL, remoteAddress, payload: batch })).statusCode;

    const statuses = [
      await from("2001:db8:1:2:aaaa:bbbb:cccc:dddd"),
      await from("2001:db8:1:2:1111:2222:3333:4444"),
      await from("2001:0db8:0001:0002::1"),
      await from("2001:db8:1:3::1"),
      await from("2001:db8:1:3::"),
      await from("203.0.113.5"),
      await from("::ffff:203.0.113.5"),
    ];

    expect(statuses).toEqual([202, 429, 429, 202, 429, 202, 429]);
  });

  it("keys the limit on the forwarded address when the peer is a trusted proxy, so two clients behind it have separate buckets", async () => {
    const instance = await build({ rateLimit: { max: 1, windowMs: 60_000 } }, trustNearestProxy);
    const batch = { events: [{ name: "client.info", at: AT }] };
    const from = (forwardedFor: string) =>
      instance.inject({ method: "POST", url: INGEST_URL, remoteAddress: "10.0.0.1", headers: { "x-forwarded-for": forwardedFor }, payload: batch });

    const statuses = [
      (await from("203.0.113.5")).statusCode,
      (await from("203.0.113.6")).statusCode,
      (await from("203.0.113.5")).statusCode,
      (await from("198.51.100.1, 203.0.113.6")).statusCode,
    ];

    expect(statuses).toEqual([202, 202, 429, 429]);
  });

  it("shares one bucket among every client when the proxy is not trusted", async () => {
    const instance = await build({ rateLimit: { max: 1, windowMs: 60_000 } });
    const batch = { events: [{ name: "client.info", at: AT }] };
    const from = (forwardedFor: string) =>
      instance.inject({ method: "POST", url: INGEST_URL, remoteAddress: "10.0.0.1", headers: { "x-forwarded-for": forwardedFor }, payload: batch });

    expect([(await from("203.0.113.5")).statusCode, (await from("203.0.113.6")).statusCode]).toEqual([202, 429]);
  });

  it("rate-limits before it reads the body, so a refused request costs no parse, and its refusal echoes and logs nothing of it", async () => {
    const instance = await build({ rateLimit: { max: 0, windowMs: 60_000 } });

    const response = await instance.inject({
      method: "POST",
      url: INGEST_URL,
      headers: { "content-type": "application/json", "x-forwarded-for": LEAK },
      payload: `{"events": "${LEAK}`,
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ type: problemType("request/rate-limited"), status: 429 });
    expect(response.body).not.toContain(LEAK);
    expect(JSON.stringify(telemetry.logs())).not.toContain(LEAK);
    expect(JSON.stringify(await telemetry.metrics())).not.toContain(LEAK);
  });

  it("sheds client log events past the global cap with 202, keeps session.abandoned, and counts the shed as over capacity", async () => {
    const instance = await build({ eventsPerSecond: 4 });
    const abandoned = { name: "session.abandoned", at: AT, fields: { sessionId: SESSION_ID, lastItemId: "itm_02" } };
    const logEvents = Array.from({ length: 5 }, () => ({ name: "client.info", at: AT }));

    const response = await post(instance, { events: [...logEvents, abandoned] });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 4, dropped: 2 });
    expect(telemetry.logs().filter((line) => line.msg === "client.info")).toHaveLength(3);
    expect(telemetry.logs().filter((line) => line.msg === "session.abandoned")).toHaveLength(1);
    const dropped = (await telemetry.metrics()).find((metric) => metric.descriptor.name === "telemetry.ingest.dropped");
    expect(dropped?.dataPoints.map((point) => ({ value: point.value, attributes: point.attributes }))).toContainEqual({
      value: 2,
      attributes: { "telemetry.ingest_reason": "over_capacity" },
    });
  });

  it("shares the global cap among addresses, so a second address is shed once the first has used the log events of that second", async () => {
    const instance = await build({ eventsPerSecond: 4 });
    const batch = { events: Array.from({ length: 3 }, () => ({ name: "client.info", at: AT })) };
    const from = async (remoteAddress: string) =>
      (await instance.inject({ method: "POST", url: INGEST_URL, remoteAddress, payload: batch })).json<{ accepted: number }>().accepted;

    expect([await from("203.0.113.5"), await from("203.0.113.6")]).toEqual([3, 0]);
  });
});
