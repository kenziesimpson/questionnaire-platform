import { definitionApi, type BodyOf, type Problem, type QuestionnaireDraft, type VersionSummary } from "@qp/shared";

export interface VersionedDraft {
  draft: QuestionnaireDraft;
  etag: string;
}

export type DraftContent = BodyOf<typeof definitionApi.replaceDraft>;

export type DraftChange = (draft: QuestionnaireDraft) => QuestionnaireDraft;

export type DraftRejection =
  | { kind: "stale"; problem: Problem<"questionnaire/draft-stale"> }
  | { kind: "invalid"; problem: Problem<"questionnaire/draft-invalid"> }
  | { kind: "failed"; error: Error };

export type PublishOutcome =
  | { kind: "published"; version: VersionSummary }
  | { kind: "refused"; rejection: DraftRejection }
  | { kind: "superseded" };

export interface DraftMutation {
  change: (apply: DraftChange) => void;
  publish: () => Promise<PublishOutcome>;
  rejection: DraftRejection | null;
  dismissRejection: () => void;
  isSaving: boolean;
}
