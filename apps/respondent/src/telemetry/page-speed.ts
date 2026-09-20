import { emitDomainEvent } from "@qp/telemetry";

export interface PagePerformance {
  getEntriesByType(type: "navigation"): readonly { readonly duration: number }[];
}

export function reportPageLoad(performance: PagePerformance, route: string): void {
  const duration = performance.getEntriesByType("navigation")[0]?.duration;
  if (duration === undefined || !(duration > 0)) return;
  emitDomainEvent({ name: "page.loaded", route, durationMs: Math.round(duration) });
}
