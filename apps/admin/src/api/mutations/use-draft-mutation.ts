import type { QuestionnaireDraft } from "@qp/shared";
import { useIsMutating, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { draftApi } from "../client";
import {
  SupersededDraftWrite,
  bumpGeneration,
  createLedger,
  etagToSend,
  recordSuccess,
  type DraftWriteLedger,
  type QueuedWrite,
} from "../draft-write-ledger";
import type { DraftChange, DraftMutation, DraftRejection, PublishOutcome, VersionedDraft } from "../draft-types";
import { isProblem } from "../problem-error";
import { questionnaireQueries } from "../queries";
import { draftWriteScope, queryKeys } from "../query-keys";

interface QueuedChange extends QueuedWrite {
  previous: VersionedDraft;
  next: QuestionnaireDraft;
}

const ledgersByClient = new WeakMap<QueryClient, Map<string, DraftWriteLedger>>();

function ledgerFor(queryClient: QueryClient, questionnaireId: string): DraftWriteLedger {
  const ledgers = ledgersByClient.get(queryClient) ?? new Map<string, DraftWriteLedger>();
  ledgersByClient.set(queryClient, ledgers);
  const ledger = ledgers.get(questionnaireId) ?? createLedger();
  ledgers.set(questionnaireId, ledger);
  return ledger;
}

function rejectionOf(error: Error): DraftRejection {
  if (isProblem(error, "questionnaire/draft-stale")) return { kind: "stale", problem: error.problem };
  if (isProblem(error, "questionnaire/draft-invalid")) return { kind: "invalid", problem: error.problem };
  return { kind: "failed", error };
}

export function useDraftMutation(questionnaireId: string): DraftMutation {
  const queryClient = useQueryClient();
  const [rejection, setRejection] = useState<DraftRejection | null>(null);
  const scopeId = draftWriteScope(questionnaireId);
  const draftKey = questionnaireQueries.draft(questionnaireId).queryKey;
  const validationKey = questionnaireQueries.draftValidation(questionnaireId).queryKey;
  const writesPending = useIsMutating({ predicate: (mutation) => mutation.options.scope?.id === scopeId });

  const recordRejection = (error: Error, write: QueuedWrite): DraftRejection => {
    const ledger = ledgerFor(queryClient, questionnaireId);
    bumpGeneration(ledger, write.generation);
    const next = rejectionOf(error);
    setRejection(next);
    if (next.kind === "stale") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.draft(questionnaireId), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.draftValidation(questionnaireId), exact: true });
    }
    return next;
  };

  const changeMutation = useMutation({
    scope: { id: scopeId },
    mutationFn: async (write: QueuedChange) => {
      const ledger = ledgerFor(queryClient, questionnaireId);
      const etag = etagToSend(ledger, write);
      const saved = await draftApi.replace(questionnaireId, { title: write.next.title, items: write.next.items }, etag);
      recordSuccess(ledger, etag, saved.etag);
      return saved;
    },
    onSuccess: (saved, write) => {
      const otherWritesPending =
        queryClient.isMutating({ predicate: (mutation) => mutation.options.scope?.id === scopeId }) > 1;
      const cached = queryClient.getQueryData(draftKey);
      if (cached?.draft === write.next || !otherWritesPending) queryClient.setQueryData(draftKey, saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.draftValidation(questionnaireId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.list() });
    },
    onError: (error, write) => {
      if (error instanceof SupersededDraftWrite) return;
      queryClient.setQueryData(draftKey, write.previous);
      recordRejection(error, write);
    },
  });

  const publishMutation = useMutation({
    scope: { id: scopeId },
    mutationFn: (write: QueuedWrite) =>
      draftApi.publish(questionnaireId, etagToSend(ledgerFor(queryClient, questionnaireId), write)),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.questionnaires.draft(questionnaireId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.versions(questionnaireId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.list() });
    },
    onError: (error, write) => {
      if (error instanceof SupersededDraftWrite) return;
      const refused = recordRejection(error, write);
      if (refused.kind === "invalid") {
        queryClient.setQueryData(validationKey, { valid: false, items: refused.problem.items });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.draftValidation(questionnaireId), exact: true });
    },
  });

  const loadedDraft = (): VersionedDraft => {
    const cached = queryClient.getQueryData(draftKey);
    if (cached === undefined) throw new Error(`The draft of questionnaire ${questionnaireId} is not loaded`);
    return cached;
  };

  const change = (apply: DraftChange) => {
    void queryClient.cancelQueries({ queryKey: queryKeys.questionnaires.draft(questionnaireId), exact: true });
    const previous = loadedDraft();
    const next = apply(previous.draft);
    queryClient.setQueryData(draftKey, { draft: next, etag: previous.etag });
    const { generation } = ledgerFor(queryClient, questionnaireId);
    changeMutation.mutate({ previous, next, baseEtag: previous.etag, generation });
  };

  const publish = async (): Promise<PublishOutcome> => {
    const { etag } = loadedDraft();
    const { generation } = ledgerFor(queryClient, questionnaireId);
    try {
      return { kind: "published", version: await publishMutation.mutateAsync({ baseEtag: etag, generation }) };
    } catch (error) {
      if (error instanceof SupersededDraftWrite || !(error instanceof Error)) return { kind: "superseded" };
      return { kind: "refused", rejection: rejectionOf(error) };
    }
  };

  return {
    change,
    publish,
    rejection,
    dismissRejection: () => setRejection(null),
    isSaving: writesPending > 0,
  };
}
