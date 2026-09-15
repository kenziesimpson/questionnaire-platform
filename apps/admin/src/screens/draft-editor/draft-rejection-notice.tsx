import type { QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import type { DraftRejection } from "../../api/use-draft-mutation";
import { AlertCircleIcon } from "./icons";

export type DraftWrite = "change" | "publish";

interface Copy {
  title: string;
  body: string;
  tone: "neutral" | "destructive";
}

function copyFor(kind: DraftRejection["kind"], write: DraftWrite): Copy {
  switch (kind) {
    case "stale":
      return {
        title: "Someone else changed this draft",
        body:
          write === "publish"
            ? "It was not published. The draft has been reloaded with their changes; check it and publish again."
            : "Your last change was undone and nothing you did was written. The draft has been reloaded with their version, so carry on from there.",
        tone: "neutral",
      };
    case "invalid":
      return write === "publish"
        ? {
            title: "The draft was not published",
            body: "Publish found problems in the draft. They are listed under Publish checks.",
            tone: "destructive",
          }
        : {
            title: "This draft cannot be saved right now",
            body: "Your last change was undone. The server refused the draft itself because of the items below; this is not another author's edit. Changes will keep failing until those items are dealt with.",
            tone: "destructive",
          };
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

function slugOf(rejection: DraftRejection): string | null {
  switch (rejection.kind) {
    case "stale":
      return "409 questionnaire/draft-stale";
    case "invalid":
      return "422 questionnaire/draft-invalid";
    case "failed":
      return null;
  }
}

export function DraftRejectionNotice({
  rejection,
  write,
  draft,
  onDismiss,
}: {
  rejection: DraftRejection;
  write: DraftWrite;
  draft: QuestionnaireDraft;
  onDismiss: () => void;
}) {
  const { title, body, tone } = copyFor(rejection.kind, write);
  const slug = slugOf(rejection);
  const refusedItems = rejection.kind === "invalid" && write === "change" ? rejection.problem.items : [];
  return (
    <div
      role="alert"
      data-rejection={rejection.kind}
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
                <li key={`${itemId}:${code}`}>
                  {position === 0 ? itemId : `Question ${position}`} ·{" "}
                  <code className="font-mono text-[11px] text-muted-foreground">{code}</code>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {slug !== null && <code className="mt-0.5 font-mono text-[11px] whitespace-nowrap text-muted-foreground">{slug}</code>}
      <Button type="button" variant="outline" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
