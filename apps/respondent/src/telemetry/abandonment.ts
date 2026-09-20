import { emitDomainEvent } from "@qp/telemetry";

export interface SessionProgress {
  readonly sessionId: string;
  readonly lastItemId: string | null;
}

type ProgressProbe = () => SessionProgress | undefined;

const MAX_REMEMBERED_SESSIONS = 100;

const probes = new Set<ProgressProbe>();

const reported = new Set<string>();

function remember(sessionId: string): void {
  reported.add(sessionId);
  if (reported.size > MAX_REMEMBERED_SESSIONS) {
    const oldest = reported.values().next();
    if (!oldest.done) reported.delete(oldest.value);
  }
}

export function watchAbandonment(probe: ProgressProbe): () => void {
  probes.add(probe);
  return () => {
    probes.delete(probe);
  };
}

export function reportAbandonment(): void {
  for (const probe of probes) {
    const progress = probe();
    if (progress === undefined || reported.has(progress.sessionId)) continue;
    remember(progress.sessionId);
    emitDomainEvent({ name: "session.abandoned", sessionId: progress.sessionId, lastItemId: progress.lastItemId });
  }
}
