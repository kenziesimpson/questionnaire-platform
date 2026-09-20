import { emitDomainEvent } from "@qp/telemetry";

export interface SessionProgress {
  readonly sessionId: string;
  readonly lastItemId: string | null;
}

type ProgressProbe = () => SessionProgress | undefined;

const watched = new Map<ProgressProbe, Set<string>>();

export function watchAbandonment(probe: ProgressProbe): () => void {
  watched.set(probe, new Set());
  return () => {
    watched.delete(probe);
  };
}

export function reportAbandonment(): void {
  for (const [probe, reported] of watched) {
    const progress = probe();
    if (progress === undefined || reported.has(progress.sessionId)) continue;
    reported.add(progress.sessionId);
    emitDomainEvent({ name: "session.abandoned", sessionId: progress.sessionId, lastItemId: progress.lastItemId });
  }
}
