export function formatDraftEtag(versionId: string, draftRevision: number): string {
  return `W/"${versionId}:${draftRevision}"`;
}

const DRAFT_ETAG = /^W\/"([0-9a-f-]{36}):(0|[1-9][0-9]*)"$/i;

export interface DraftPrecondition {
  readonly versionId: string;
  readonly draftRevision: number;
}

export function parseDraftEtag(etag: string): DraftPrecondition | undefined {
  const match = DRAFT_ETAG.exec(etag.trim());
  if (!match) return undefined;
  const versionId = match[1];
  if (versionId === undefined) throw new Error(`DRAFT_ETAG matched without its mandatory version-id group: ${etag}`);
  return { versionId: versionId.toLowerCase(), draftRevision: Number(match[2]) };
}

export function isDraftEtagFor(etag: string | null | undefined, versionId: string): boolean {
  if (etag === null || etag === undefined) return false;
  return parseDraftEtag(etag)?.versionId === versionId.toLowerCase();
}

export function snapshotEtag(questionnaireId: string, version: number, formatVersion: number): string {
  return `"${questionnaireId}:${version}:${formatVersion}"`;
}
