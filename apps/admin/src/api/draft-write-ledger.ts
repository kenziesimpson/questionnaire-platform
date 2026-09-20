export interface DraftWriteLedger {
  generation: number;
  successors: Map<string, string>;
}

export interface QueuedWrite {
  baseEtag: string;
  generation: number;
}

export class SupersededDraftWrite extends Error {
  constructor() {
    super("An earlier draft write was rejected, so this one was built on a draft the server never accepted");
    this.name = "SupersededDraftWrite";
  }
}

export function createLedger(): DraftWriteLedger {
  return { generation: 0, successors: new Map<string, string>() };
}

export function etagToSend(ledger: DraftWriteLedger, write: QueuedWrite): string {
  if (write.generation !== ledger.generation) throw new SupersededDraftWrite();
  let etag = write.baseEtag;
  for (let successor = ledger.successors.get(etag); successor !== undefined; successor = ledger.successors.get(etag)) {
    etag = successor;
  }
  return etag;
}

export function recordSuccess(ledger: DraftWriteLedger, etag: string, savedEtag: string): void {
  ledger.successors.set(etag, savedEtag);
}

export function bumpGeneration(ledger: DraftWriteLedger, writeGeneration: number): void {
  ledger.generation = Math.max(ledger.generation, writeGeneration + 1);
}
