import type { DraftItemCode, QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { useId, useState, type ReactNode, type Ref } from "react";
import { problemCount } from "../../components/counts";
import { AlertCircleIcon, ArrowRightIcon, CheckIcon, SpinnerIcon } from "../../components/icons";
import { Pill } from "../../components/pill";
import { DRAFT_ITEM_MESSAGES } from "./draft-item-messages";
import { promptOf } from "./draft-changes";

export interface DraftItemProblem {
  itemId: string;
  code: DraftItemCode;
}

export type PublishChecks =
  | { status: "checking" }
  | { status: "unavailable"; retry: () => void; retrying: boolean }
  | { status: "checked"; problems: readonly DraftItemProblem[]; refreshing: boolean };

export interface JumpOptions {
  openRules: boolean;
}

export interface PublishChecksPanelProps {
  draft: QuestionnaireDraft;
  checks: PublishChecks;
  nextVersion?: number;
  headingRef?: Ref<HTMLHeadingElement>;
  activeItemId?: string | null;
  onJumpToItem: (itemId: string, options: JumpOptions) => void;
}

export interface ProblemGroup {
  itemId: string;
  codes: DraftItemCode[];
}

export function groupByItem(problems: readonly DraftItemProblem[]): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const { itemId, code } of problems) {
    const group = groups.get(itemId) ?? { itemId, codes: [] };
    group.codes.push(code);
    groups.set(itemId, group);
  }
  return [...groups.values()];
}

type Settled = number | "unavailable";

function settledOf(checks: PublishChecks): Settled | null {
  if (checks.status === "unavailable") return "unavailable";
  if (checks.status === "checked" && !checks.refreshing) return checks.problems.length;
  return null;
}

function announcementFor(previous: Settled, next: Settled, empty: boolean): string {
  if (next === "unavailable") return "Publish checks could not run.";
  if (next === 0) {
    return empty ? "Publish checks: no problems, but this draft has no questions yet." : "Publish checks: no problems. Ready to publish.";
  }
  if (previous !== "unavailable" && next < previous) return `Publish checks: ${previous - next} fixed, ${next} left.`;
  return `Publish checks: ${problemCount(next)}.`;
}

function useCountAnnouncement(checks: PublishChecks, empty: boolean): string {
  const [announced, setAnnounced] = useState<{ settled: Settled | null; message: string }>({ settled: null, message: "" });
  const settled = settledOf(checks);
  if (settled !== null && settled !== announced.settled) {
    setAnnounced({
      settled,
      message: announced.settled === null ? "" : announcementFor(announced.settled, settled, empty),
    });
  }
  return announced.message;
}

function statusSummary(problems: number, questions: number) {
  if (problems === 1) return "Fix 1 problem to publish.";
  return `Fix ${problems} problems in ${questions === 1 ? "1 question" : `${questions} questions`} to publish.`;
}

function clearSummary(draft: QuestionnaireDraft, nextVersion: number | undefined) {
  if (draft.items.length === 0) return "No problems found, but this draft has no questions yet.";
  if (nextVersion === undefined) return "No problems found. This draft is ready to publish.";
  return `No problems found. Publishing creates version ${nextVersion}.`;
}

function CountChip({ checks, empty }: { checks: PublishChecks; empty: boolean }) {
  if (checks.status === "unavailable") return <Pill className="h-5 text-[11px] text-muted-foreground">Not run</Pill>;
  if (checks.status !== "checked") return null;
  if (checks.problems.length > 0) {
    return <Pill className="h-5 border-destructive/40 text-[11px] text-destructive">{problemCount(checks.problems.length)}</Pill>;
  }
  if (checks.refreshing || empty) return null;
  return (
    <Pill className="h-5 gap-1 text-[11px] text-muted-foreground">
      <CheckIcon size={11} />
      Ready
    </Pill>
  );
}

function StatusLine({ busy, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <p className={`flex items-center gap-2 px-3.5 pt-1.5 pb-3 text-[13px] ${busy ? "text-muted-foreground" : ""}`}>
      {busy && <SpinnerIcon className="shrink-0 motion-safe:animate-spin" />}
      {children}
    </p>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 border-t border-border px-3.5 py-3">
      <span className="block h-2.5 w-3/5 rounded-full bg-muted" />
      <span className="block h-2.5 w-11/12 rounded-full bg-muted" />
      <span className="block h-2.5 w-3/4 rounded-full bg-muted" />
    </div>
  );
}

function Group({
  draft,
  group,
  active,
  onJumpToItem,
}: {
  draft: QuestionnaireDraft;
  group: ProblemGroup;
  active: boolean;
  onJumpToItem: PublishChecksPanelProps["onJumpToItem"];
}) {
  const index = draft.items.findIndex((item) => item.itemId === group.itemId);
  const item = draft.items[index];
  const position = index + 1;
  return (
    <li
      data-item-id={group.itemId}
      data-active={active || undefined}
      className="flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-b-0 data-active:bg-muted @min-[40rem]:odd:border-r @min-[40rem]:nth-last-2:odd:border-b-0"
    >
      {item === undefined ? (
        <span className="text-[13px] text-muted-foreground">A question no longer in this draft</span>
      ) : (
        <button
          type="button"
          aria-label={`Go to question ${position}, “${promptOf(draft, item)}”`}
          className="group/jump flex items-start gap-2 rounded-sm text-left text-[13px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() =>
            onJumpToItem(group.itemId, { openRules: group.codes.some((code) => DRAFT_ITEM_MESSAGES[code].opensRules) })
          }
        >
          <span className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-md border border-border bg-muted px-1 font-mono text-[11.5px] font-normal text-muted-foreground">
            {position}
          </span>
          <span className="pt-px underline decoration-ring underline-offset-4 group-hover/jump:decoration-foreground">
            {promptOf(draft, item)}
          </span>
          <ArrowRightIcon className="mt-0.5 ml-auto shrink-0 text-muted-foreground" />
        </button>
      )}
      <ul className="flex flex-col gap-2 pl-7">
        {group.codes.map((code) => {
          const message = DRAFT_ITEM_MESSAGES[code];
          const explanation = item === undefined ? null : message.explain({ draft, item, position });
          return (
            <li key={code} data-code={code} className="flex flex-col gap-0.5">
              <p className="relative text-[13px] font-semibold">
                <AlertCircleIcon size={13} className="absolute top-[3px] -left-[19px] text-destructive" />
                {message.title}
              </p>
              {explanation !== null && (
                <p className="text-[12.5px] leading-normal text-muted-foreground">
                  {explanation.detail} {explanation.fix}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export function PublishChecksPanel({ draft, checks, nextVersion, headingRef, activeItemId = null, onJumpToItem }: PublishChecksPanelProps) {
  const headingId = useId();
  const empty = draft.items.length === 0;
  const announcement = useCountAnnouncement(checks, empty);
  const groups = checks.status === "checked" ? groupByItem(checks.problems) : [];
  return (
    <section
      aria-labelledby={headingId}
      className="@container flex min-h-0 flex-col rounded-xl border border-border bg-background"
    >
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-[13px] font-semibold outline-none focus:ring-3 focus:ring-ring/50"
        >
          Publish checks
        </h2>
        <CountChip checks={checks} empty={empty} />
      </div>
      {checks.status === "checking" && (
        <>
          <StatusLine busy>Checking the draft…</StatusLine>
          <Skeleton />
        </>
      )}
      {checks.status === "unavailable" && (
        <div className="flex flex-col items-start gap-2.5 px-3.5 pt-1.5 pb-3 text-[13px]">
          <p>The checks could not run. Publishing runs them too, so nothing with a problem can be published.</p>
          <Button type="button" variant="outline" size="sm" disabled={checks.retrying} onClick={checks.retry}>
            {checks.retrying ? "Checking…" : "Run checks again"}
          </Button>
        </div>
      )}
      {checks.status === "checked" &&
        (checks.refreshing ? (
          <StatusLine busy>Checking your latest change…</StatusLine>
        ) : (
          <StatusLine>
            {groups.length === 0 ? clearSummary(draft, nextVersion) : statusSummary(checks.problems.length, groups.length)}
          </StatusLine>
        ))}
      {groups.length > 0 && (
        <ul
          aria-label="Problems"
          aria-busy={checks.status === "checked" && checks.refreshing ? true : undefined}
          className={`grid min-h-0 overflow-y-auto border-t border-border @min-[40rem]:grid-cols-2 ${checks.status === "checked" && checks.refreshing ? "opacity-75" : ""}`}
        >
          {groups.map((group) => (
            <Group
              key={group.itemId}
              draft={draft}
              group={group}
              active={group.itemId === activeItemId}
              onJumpToItem={onJumpToItem}
            />
          ))}
        </ul>
      )}
      <p className="border-t border-border px-3.5 py-2.5 text-xs text-muted-foreground">
        Rechecked after each saved change, with the same rules publishing uses.
      </p>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </section>
  );
}
