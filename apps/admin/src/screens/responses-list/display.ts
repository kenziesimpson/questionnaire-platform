import type { SessionStatus, SessionSummary } from "@qp/shared";

export function statusLabel(status: SessionStatus): string {
  return status === "submitted" ? "Submitted" : "In progress";
}

export function answeredSummary(session: Pick<SessionSummary, "status" | "itemCount" | "answeredCount" | "hiddenCount">): string {
  if (session.status !== "submitted") {
    return "Not stored until submit";
  }
  const base = `${session.answeredCount} of ${session.itemCount}`;
  return session.hiddenCount === 0 ? base : `${base} · ${session.hiddenCount} hidden by rules`;
}

export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}
