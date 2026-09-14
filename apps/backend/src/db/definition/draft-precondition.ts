export interface DraftPrecondition {
  readonly versionId: string;
  readonly draftRevision: number;
}

export function isCurrentDraft(precondition: DraftPrecondition, current: DraftPrecondition): boolean {
  return precondition.versionId === current.versionId && precondition.draftRevision === current.draftRevision;
}
