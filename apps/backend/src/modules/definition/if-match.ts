import { parseDraftEtag } from "@qp/shared";

export interface DraftPrecondition {
  readonly versionId: string;
  readonly draftRevision: number;
}

export class MalformedDraftPrecondition extends Error {
  constructor() {
    super("If-Match is not a draft ETag this server issued");
    this.name = "MalformedDraftPrecondition";
  }
}

export function draftPreconditionOf(ifMatch: string): DraftPrecondition {
  const parsed = parseDraftEtag(ifMatch);
  if (parsed === undefined) {
    throw new MalformedDraftPrecondition();
  }
  return parsed;
}

export function isCurrentDraft(precondition: DraftPrecondition, current: DraftPrecondition): boolean {
  return precondition.versionId === current.versionId && precondition.draftRevision === current.draftRevision;
}
