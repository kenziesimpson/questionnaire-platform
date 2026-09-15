import type { QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import type { DraftRejection } from "../../api/use-draft-mutation";
import { problemCount } from "../../components/counts";
import { AlertCircleIcon } from "../../components/icons";
import { DRAFT_ITEM_MESSAGES } from "./draft-item-messages";

export type DraftWrite = "change" | "publish";

interface Copy {
  title: string;
  body: string;
  tone: "neutral" | "destructive";
}

function copyFor(rejection: DraftRejection, write: DraftWrite): Copy {
  switch (rejection.kind) {
    case "stale":
      return {
        title: "Someone else changed this draft",
        body:
          write === "publish"
            ? "It was not published. The draft has been reloaded with their changes; check it and publish again."
            : "Your last change was undone and nothing you did was written. The draft has been reloaded with their version, so carry on from there.",
        tone: "neutral",
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
            tone: "destructive",
          }
        : {
            title: "Your last change was not saved",
            body: "The server refused it for the reason below, so it was undone. This is not another author's edit.",
            tone: "destructive",
          };
    }
    case "failed":
      return {
        title: write === "publish" ? "The draft was not published" : "Your last change was not saved",
        body:
          write === "publish"
            ? "Something went wrong reaching the server. Try publishing again."
            : "It was undone. Something went wrong reaching the server; check the connection and try again.",
        tone: "destructive",
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
  const { title, body, tone } = copyFor(rejection, write);
  const refusedItems = rejection.kind === "invalid" && write === "change" ? rejection.problem.items : [];
  const pointsToChecks = rejection.kind === "invalid" && write === "publish";
  return (
    <div
      role="alert"
      data-rejection={rejection.kind}
      data-problem={slugOf(rejection)}
      className={`flex items-start gap-3.5 rounded-xl border px-4 py-3.5 ${tone === "destructive" ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted"}`}
    >
      <AlertCircleIcon className={`mt-0.5 shrink-0 ${tone === "destructive" ? "text-destructive" : ""}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[13px] leading-normal text-muted-foreground">{body}</p>
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
    </div>
  );
}
