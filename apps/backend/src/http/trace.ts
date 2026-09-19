import { activeTraceId } from "@qp/telemetry";

export function auditTraceId(): string | null {
  return activeTraceId() ?? null;
}
