export const DEFAULT_INGEST_EVENTS_PER_SECOND = 200;

const DOMAIN_EVENT_RESERVE_SHARE = 0.25;

export type IngestEventKind = "log" | "domain";

export interface IngestCapacity {
  admit(kind: IngestEventKind, at: number): boolean;
}

export function createIngestCapacity(eventsPerSecond: number = DEFAULT_INGEST_EVENTS_PER_SECOND): IngestCapacity {
  const logCeiling = eventsPerSecond - Math.ceil(eventsPerSecond * DOMAIN_EVENT_RESERVE_SHARE);
  let second = Number.NaN;
  let admitted = 0;

  return {
    admit(kind, at) {
      const current = Math.floor(at / 1000);
      if (current !== second) {
        second = current;
        admitted = 0;
      }
      if (admitted >= (kind === "domain" ? eventsPerSecond : logCeiling)) return false;
      admitted += 1;
      return true;
    },
  };
}
