import { telemetryApi } from "@qp/shared";
import { createTransport, type Transport } from "@qp/telemetry/browser";

export function browserTransport(): Transport {
  return createTransport({
    url: telemetryApi.TELEMETRY_PREFIX,
    fetch: (url, init) => fetch(url, init),
    sendBeacon: (url, data) => navigator.sendBeacon(url, data),
  });
}
