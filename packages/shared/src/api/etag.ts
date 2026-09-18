export function formatDraftEtag(versionId: string, draftRevision: number): string {
  return `W/"${versionId}:${draftRevision}"`;
}

const DRAFT_ETAG = /^W\/"([0-9a-f-]{36}):(0|[1-9][0-9]*)"$/i;

export function parseDraftEtag(etag: string): { versionId: string; draftRevision: number } | undefined {
  const match = DRAFT_ETAG.exec(etag.trim());
  if (!match) return undefined;
  return { versionId: match[1]!.toLowerCase(), draftRevision: Number(match[2]) };
}

export function isDraftEtagFor(etag: string | null | undefined, versionId: string): boolean {
  if (etag === null || etag === undefined) return false;
  return parseDraftEtag(etag)?.versionId === versionId.toLowerCase();
}

export function snapshotEtag(questionnaireId: string, version: number, formatVersion: number): string {
  return `"${questionnaireId}:${version}:${formatVersion}"`;
}
