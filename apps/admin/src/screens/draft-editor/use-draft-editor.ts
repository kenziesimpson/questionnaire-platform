import type { Question, QuestionnaireSummary } from "@qp/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { DraftChange, DraftRejection } from "../../api/draft-types";
import { useDraftMutation } from "../../api/mutations/use-draft-mutation";
import { questionQueries, questionnaireQueries } from "../../api/queries";
import { useQuestionEditor, type QuestionEditor } from "../../features/question-editor/use-question-editor";
import { itemDomId, rulesEditorOf } from "./item-dom";
import type { DraftWrite } from "./draft-rejection-notice";
import type { JumpOptions, PublishChecks } from "./publish-checks-panel";
import { publishWaitsFor, type PublishHint } from "./publish-checks";

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface DraftEditorHook {
  questionEditor: QuestionEditor;
  rejection: DraftRejection | null;
  dismissRejection: () => void;
  lastWrite: DraftWrite;
  isSaving: boolean;
  adding: boolean;
  setAdding: (adding: boolean) => void;
  publishing: boolean;
  openRules: ReadonlySet<string>;
  setRulesOpen: (itemId: string, open: boolean) => void;
  jumpedItemId: string | null;
  onJumpEnd: (itemId: string) => void;
  jumpToItem: (itemId: string, options: JumpOptions) => void;
  checksHeadingRef: RefObject<HTMLHeadingElement | null>;
  publishHintId: string;
  bankById: ReadonlyMap<string, Question>;
  change: (apply: DraftChange) => void;
  publish: () => Promise<void>;
  focusChecks: () => void;
  checks: PublishChecks;
  publishHint: PublishHint | null;
  nextVersion: number | undefined;
}

export function useDraftEditor(questionnaireId: string, summary: QuestionnaireSummary | undefined): DraftEditorHook {
  const navigate = useNavigate();
  const mutation = useDraftMutation(questionnaireId);
  const validation = useQuery(questionnaireQueries.draftValidation(questionnaireId));
  const bank = useQuery(questionQueries.list(true));
  const editor = useQuestionEditor();
  const [lastWrite, setLastWrite] = useState<DraftWrite>("change");
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [openRules, setOpenRules] = useState<ReadonlySet<string>>(() => new Set());
  const [jumpedItemId, setJumpedItemId] = useState<string | null>(null);
  const checksHeadingRef = useRef<HTMLHeadingElement>(null);
  const publishHintId = useId();
  const bankById = new Map((bank.data ?? []).map((question) => [question.questionId, question]));

  const change = (apply: DraftChange) => {
    mutation.dismissRejection();
    setLastWrite("change");
    mutation.change(apply);
  };

  const focusChecks = () => checksHeadingRef.current?.focus();

  const publish = async () => {
    mutation.dismissRejection();
    setLastWrite("publish");
    setPublishing(true);
    const outcome = await mutation.publish();
    if (outcome.kind === "published") {
      void navigate({ to: "/questionnaires/$questionnaireId/versions", params: { questionnaireId } });
      return;
    }
    setPublishing(false);
    if (outcome.kind === "refused" && outcome.rejection.kind === "invalid") focusChecks();
  };

  const setRulesOpen = (itemId: string, open: boolean) =>
    setOpenRules((current) => {
      const next = new Set(current);
      if (open) next.add(itemId);
      else next.delete(itemId);
      return next;
    });

  const onJumpEnd = (itemId: string) => setJumpedItemId((current) => (current === itemId ? null : current));

  const jumpToItem = (itemId: string, { openRules: withRules }: JumpOptions) => {
    flushSync(() => {
      if (withRules) setRulesOpen(itemId, true);
      setJumpedItemId(itemId);
    });
    const row = document.getElementById(itemDomId(itemId));
    if (row === null) return;
    row.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    ((withRules ? rulesEditorOf(itemId) : null) ?? row).focus({ preventScroll: true });
  };

  const checksBusy = validation.isFetching || mutation.isSaving;
  const checks: PublishChecks = validation.isPending
    ? { status: "checking" }
    : validation.isError
      ? { status: "unavailable", retry: () => void validation.refetch(), retrying: validation.isFetching }
      : { status: "checked", problems: validation.data.items, refreshing: checksBusy };
  const publishHint = publishWaitsFor({
    saving: mutation.isSaving,
    checking: validation.isPending || validation.isFetching,
    checksFailed: validation.isError,
    problems: validation.isSuccess ? validation.data.items.length : 0,
  });
  const nextVersion = summary === undefined ? undefined : (summary.currentVersion ?? 0) + 1;

  return {
    questionEditor: editor,
    rejection: mutation.rejection,
    dismissRejection: mutation.dismissRejection,
    lastWrite,
    isSaving: mutation.isSaving,
    adding,
    setAdding,
    publishing,
    openRules,
    setRulesOpen,
    jumpedItemId,
    onJumpEnd,
    jumpToItem,
    checksHeadingRef,
    publishHintId,
    bankById,
    change,
    publish,
    focusChecks,
    checks,
    publishHint,
    nextVersion,
  };
}
