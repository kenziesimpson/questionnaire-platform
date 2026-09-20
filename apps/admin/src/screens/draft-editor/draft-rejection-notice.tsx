import type { QuestionnaireDraft } from "@qp/shared";
import { AlertCircleIcon } from "@qp/ui/icons";
import { Alert, AlertDescription, AlertTitle } from "@qp/ui/primitives/alert";
import { Button } from "@qp/ui/primitives/button";
import type { DraftRejection } from "../../api/draft-types";
import { problemCount } from "../../lib/counts";
import { DRAFT_ITEM_MESSAGES } from "./draft-item-messages";

export type DraftWrite = "change" | "publish";

interface Copy {
  title: string;
  body: string;
  variant: "default" | "destructive";
}

function copyFor(rejection: DraftRejection, write: DraftWrite): Copy {
  switch (rejection.kind) {
    case "stale":
      return {
        title: "Someone else changed this draft",
        body:
          write === "publish"
            ? "It was not published. The draft has been reloaded with their changes; check it and publish again."
            : "Your last change was undone and the draft has been reloaded with their version, so carry on from there.",
        variant: "default",
      };
    case "invalid": {
      const found = rejection.problem.items.length;
      return write === "publish"
        ? {
            title: "The draft was not published",
            body:
              found === 0
                ? "Publishing found problems in the draft. They are listed under Publish checks."
                : `Publishing found ${problemCount(found)}. ${found === 1 ? "It is" : "They are"} listed under Publish checks.`,
            variant: "destructive",
          }
        : {
            title: "Your last change was not saved",
            body: "The server refused it for the reason below, so it was undone. This is not another author's edit.",
            variant: "destructive",
          };
    }
    case "failed":
      return {
        title: write === "publish" ? "The draft was not published" : "Your last change was not saved",
        body:
          write === "publish"
            ? "Something went wrong reaching the server. Try publishing again."
            : "It was undone. Something went wrong reaching the server; check the connection and try again.",
        variant: "destructive",
      };
  }
}

function slugOf(rejection: DraftRejection): string | undefined {
  switch (rejection.kind) {
    case "stale":
      return "questionnaire/draft-stale";
    case "invalid":
      return "questionnaire/draft-invalid";
    case "failed":
      return undefined;
  }
}

export function DraftRejectionNotice({
  rejection,
  write,
  draft,
  onShowProblems,
  onDismiss,
}: {
  rejection: DraftRejection;
  write: DraftWrite;
  draft: QuestionnaireDraft;
  onShowProblems: () => void;
  onDismiss: () => void;
}) {
  const { title, body, variant } = copyFor(rejection, write);
  const refusedItems = rejection.kind === "invalid" && write === "change" ? rejection.problem.items : [];
  const pointsToChecks = rejection.kind === "invalid" && write === "publish";
  return (
    <Alert
      variant={variant}
      data-rejection={rejection.kind}
      data-problem={slugOf(rejection)}
      className="items-start gap-3.5 rounded-xl px-4 py-3.5"
    >
      <AlertCircleIcon size={18} className={`mt-0.5 shrink-0 ${variant === "destructive" ? "text-destructive" : ""}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
        {refusedItems.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5 text-[13px]">
            {refusedItems.map(({ itemId, code }) => {
              const position = draft.items.findIndex((item) => item.itemId === itemId) + 1;
              return (
                <li key={`${itemId}:${code}`} data-code={code}>
                  {position === 0 ? "The question being added" : `Question ${position}`} · {DRAFT_ITEM_MESSAGES[code].title}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {pointsToChecks && (
          <Button type="button" variant="outline" size="sm" onClick={onShowProblems}>
            Show problems
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Alert>
  );
}
