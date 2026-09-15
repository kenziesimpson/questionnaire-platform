import type { DraftItemCode, QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { useId } from "react";

export interface DraftItemProblem {
  itemId: string;
  code: DraftItemCode;
}

export type PublishChecks =
  | { status: "checking" }
  | { status: "unavailable"; retry: () => void }
  | { status: "checked"; problems: readonly DraftItemProblem[] };

export interface PublishChecksPanelProps {
  draft: QuestionnaireDraft;
  checks: PublishChecks;
  onJumpToItem: (itemId: string) => void;
}

function problemCount(count: number) {
  return count === 1 ? "1 problem" : `${count} problems`;
}

function ProblemRow({ draft, problem, onJumpToItem }: { draft: QuestionnaireDraft; problem: DraftItemProblem; onJumpToItem: (itemId: string) => void }) {
  const position = draft.items.findIndex((item) => item.itemId === problem.itemId) + 1;
  return (
    <li className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 last:border-b-0">
      {position === 0 ? (
        <span className="font-mono text-xs">{problem.itemId}</span>
      ) : (
        <Button type="button" variant="link" className="h-auto p-0 text-[13px]" onClick={() => onJumpToItem(problem.itemId)}>
          Question {position}
        </Button>
      )}
      <code className="font-mono text-[11px] text-muted-foreground">{problem.code}</code>
    </li>
  );
}

export function PublishChecksPanel({ draft, checks, onJumpToItem }: PublishChecksPanelProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
        <h2 id={headingId} className="text-[13px] font-semibold">
          Publish checks
        </h2>
        {checks.status === "checked" && checks.problems.length > 0 && (
          <span className="inline-flex h-5 items-center rounded-full border border-destructive/40 px-2 text-[11px] font-medium text-destructive">
            {problemCount(checks.problems.length)}
          </span>
        )}
      </div>
      <div role="status" className="flex flex-col">
        {checks.status === "checking" && <p className="px-3.5 py-3 text-sm text-muted-foreground">Checking the draft…</p>}
        {checks.status === "unavailable" && (
          <div className="flex flex-col items-start gap-2 px-3.5 py-3">
            <p className="text-sm">The checks could not run.</p>
            <Button type="button" variant="outline" size="sm" onClick={checks.retry}>
              Run them again
            </Button>
          </div>
        )}
        {checks.status === "checked" && checks.problems.length === 0 && (
          <p className="px-3.5 py-3 text-sm">No problems found. The draft can be published.</p>
        )}
      </div>
      {checks.status === "checked" && checks.problems.length > 0 && (
        <ul aria-label="Problems" className="flex flex-col">
          {checks.problems.map((problem) => (
            <ProblemRow key={`${problem.itemId}:${problem.code}`} draft={draft} problem={problem} onJumpToItem={onJumpToItem} />
          ))}
        </ul>
      )}
      <p className="border-t border-border px-3.5 py-2.5 text-xs text-muted-foreground">
        Checked as you edit, by the same code publish runs.
      </p>
    </section>
  );
}
