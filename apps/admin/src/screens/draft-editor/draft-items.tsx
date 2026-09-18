import type { UniqueIdentifier } from "@dnd-kit/core";
import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { conditionsOf, type DraftItem, type Question, type QuestionVersion, type QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { useId, useState } from "react";
import type { DraftChange } from "../../api/draft-types";
import { GripIcon, RemoveIcon, RulesIcon } from "../../components/icons";
import { InfoTip } from "../../components/info-tip";
import { Pill } from "../../components/pill";
import { SortableList, SortableRow, useSortableList } from "../../components/sortable-list";
import { isArchived, RESPONSE_TYPE_LABELS } from "../../lib/question";
import { laterReferencesIn, listOfPositions } from "./conditions";
import {
  dependantsOf,
  moveItem,
  pinnedQuestionOf,
  promptOf,
  removeItem,
  repinItem,
  setRequired,
  setVisibleWhen,
} from "./draft-changes";
import { PredicateEditor } from "./predicate-editor";

export function itemDomId(itemId: string) {
  return `draft-item-${itemId}`;
}

export function rulesEditorOf(itemId: string): HTMLElement | null {
  return document.getElementById(itemDomId(itemId))?.querySelector<HTMLElement>("[data-rules-editor]") ?? null;
}

interface DraftItemsProps {
  draft: QuestionnaireDraft;
  bank: ReadonlyMap<string, Question>;
  openRules: ReadonlySet<string>;
  jumpedItemId: string | null;
  onRulesOpenChange: (itemId: string, open: boolean) => void;
  onJumpEnd: (itemId: string) => void;
  onChange: (apply: DraftChange) => void;
  onEdit: (item: DraftItem, latest: QuestionVersion) => void;
  locked: boolean;
}

const ARCHIVED_REMOVAL_NOTE =
  "This question is archived in the question bank, so it cannot be added back once removed. Writing it again makes a new question, and its answers are not tracked together with this one's.";

function visibilitySummary(item: DraftItem) {
  const conditions = conditionsOf(item.visibleWhen);
  if (item.visibleWhen === null || conditions.length === 0) return "Always shown";
  if (conditions.length === 1) return "Shown when 1 condition is true";
  return `Shown when ${"all" in item.visibleWhen ? "all" : "any"} of ${conditions.length} conditions are true`;
}

export function DraftItems({
  draft,
  bank,
  openRules,
  jumpedItemId,
  onRulesOpenChange,
  onJumpEnd,
  onChange,
  onEdit,
  locked,
}: DraftItemsProps) {
  const nameOf = (id: UniqueIdentifier) => {
    const item = draft.items.find((candidate) => candidate.itemId === id);
    return item === undefined ? String(id) : `“${promptOf(draft, item)}”`;
  };
  const positionOf = (id: UniqueIdentifier) => draft.items.findIndex((item) => item.itemId === id) + 1;

  const controls = useSortableList({
    noun: "question",
    total: draft.items.length,
    nameOf,
    positionOf,
    onDragEnd: ({ active, over }) => {
      if (over === null || active.id === over.id) return;
      const to = draft.items.findIndex((item) => item.itemId === over.id);
      onChange(moveItem(String(active.id), to));
    },
  });

  return (
    <div>
      <SortableList ids={draft.items.map(({ itemId }) => itemId)} controls={controls} strategy={verticalListSortingStrategy}>
        <ol aria-label="Questions, in the order respondents see them" className="flex flex-col rounded-xl border border-border">
          {draft.items.map((item, index) => (
            <SortableItemRow
              key={item.itemId}
              draft={draft}
              item={item}
              position={index + 1}
              bankQuestion={bank.get(item.questionId)}
              rulesOpen={openRules.has(item.itemId)}
              jumped={jumpedItemId === item.itemId}
              onRulesOpenChange={(open) => onRulesOpenChange(item.itemId, open)}
              onJumpEnd={() => onJumpEnd(item.itemId)}
              onChange={onChange}
              onEdit={onEdit}
              locked={locked}
            />
          ))}
        </ol>
      </SortableList>
    </div>
  );
}

interface ItemRowProps {
  draft: QuestionnaireDraft;
  item: DraftItem;
  position: number;
  bankQuestion: Question | undefined;
  rulesOpen: boolean;
  jumped: boolean;
  onRulesOpenChange: (open: boolean) => void;
  onJumpEnd: () => void;
  onChange: (apply: DraftChange) => void;
  onEdit: (item: DraftItem, latest: QuestionVersion) => void;
  locked: boolean;
}

function NewerVersion({
  item,
  position,
  bankQuestion,
  onChange,
  locked,
}: Pick<ItemRowProps, "item" | "position" | "bankQuestion" | "onChange" | "locked">) {
  if (bankQuestion === undefined || isArchived(bankQuestion)) return null;
  const { latest } = bankQuestion;
  if (latest.questionVersion <= item.questionVersion) return null;
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <Pill className="text-muted-foreground">Newer version available</Pill>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={locked}
        aria-label={`Re-pin question ${position} to version ${latest.questionVersion}`}
        onClick={() => onChange(repinItem(item.itemId, latest))}
      >
        Use v{latest.questionVersion}
      </Button>
    </span>
  );
}

function SortableItemRow({
  draft,
  item,
  position,
  bankQuestion,
  rulesOpen,
  jumped,
  onRulesOpenChange,
  onJumpEnd,
  onChange,
  onEdit,
  locked,
}: ItemRowProps) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const rulesId = useId();
  const requiredId = useId();
  const nameId = useId();
  const promptId = useId();
  const question = pinnedQuestionOf(draft, item);
  const prompt = promptOf(draft, item);
  const later = laterReferencesIn(draft, item);
  const dependants = dependantsOf(draft, item.itemId).map((dependant) => draft.items.indexOf(dependant) + 1);
  const archived = bankQuestion !== undefined && isArchived(bankQuestion);

  const remove = () => {
    if ((dependants.length > 0 || archived) && !confirmingRemoval) {
      setConfirmingRemoval(true);
      return;
    }
    onChange(removeItem(item.itemId));
  };

  return (
    <SortableRow id={item.itemId} disabled={locked}>
      {({ setNodeRef, setActivatorNodeRef, attributes, listeners, style, isDragging }) => (
        <li
          ref={setNodeRef}
          id={itemDomId(item.itemId)}
          tabIndex={-1}
          aria-labelledby={`${nameId} ${promptId}`}
          data-item-id={item.itemId}
          data-jumped={jumped || undefined}
          style={style}
          onBlur={(event) => {
            if (jumped && !event.currentTarget.contains(event.relatedTarget)) onJumpEnd();
          }}
          className={`relative flex flex-col border-b border-border outline-none first:rounded-t-xl last:rounded-b-xl last:border-b-0 focus-visible:ring-3 focus-visible:ring-ring/50 ${rulesOpen ? "bg-muted" : "bg-background"} ${isDragging ? "z-10 shadow-lg ring-1 ring-foreground/10" : ""} ${jumped ? "jump-highlight" : ""}`}
        >
          <div className="flex items-start gap-3 px-3.5 py-3">
            <button
              type="button"
              ref={setActivatorNodeRef}
              aria-label={`Drag to reorder question ${position}`}
              disabled={locked}
              className="inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripIcon />
            </button>
            <span id={nameId} className="sr-only">
              Question {position},
            </span>
            <span aria-hidden="true" className="w-4 shrink-0 pt-1 font-mono text-xs text-muted-foreground">
              {position}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span id={promptId} className="pt-0.5 font-medium">
                {prompt}
              </span>
              <span className="text-xs text-muted-foreground">
                {question === undefined ? "Unknown type" : RESPONSE_TYPE_LABELS[question.type]} · pinned v{item.questionVersion} ·{" "}
                {visibilitySummary(item)}
              </span>
              {later.length > 0 && (
                <span className="text-xs text-destructive">
                  A condition uses {listOfPositions(later)}, which is now below this question.
                </span>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
                <span className="flex items-center gap-1.5">
                  <Checkbox
                    id={requiredId}
                    checked={item.required}
                    disabled={locked}
                    onCheckedChange={(checked) => onChange(setRequired(item.itemId, checked === true))}
                  />
                  <label htmlFor={requiredId} className="text-xs">
                    Required
                  </label>
                </span>
                <Button
                  type="button"
                  variant={rulesOpen ? "secondary" : "outline"}
                  size="xs"
                  aria-expanded={rulesOpen}
                  aria-controls={rulesId}
                  aria-label={`Rules for question ${position}`}
                  onClick={() => onRulesOpenChange(!rulesOpen)}
                >
                  <RulesIcon />
                  Rules
                </Button>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Edit question ${position}`}
                  disabled={locked || bankQuestion === undefined || isArchived(bankQuestion)}
                  onClick={() => {
                    if (bankQuestion !== undefined) onEdit(item, bankQuestion.latest);
                  }}
                >
                  Edit
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove question ${position}`} disabled={locked} onClick={remove}>
                  <RemoveIcon />
                </Button>
              </span>
              <NewerVersion item={item} position={position} bankQuestion={bankQuestion} onChange={onChange} locked={locked} />
            </div>
          </div>
          {confirmingRemoval && (
            <div role="alert" className="mx-3.5 mb-3 ml-[4.25rem] flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]">
              <span className="flex flex-1 items-center gap-1">
                {dependants.length > 0
                  ? `Conditions on ${listOfPositions(dependants)} use this question. Removing it removes those conditions too.`
                  : "Remove this question from the draft?"}
                {archived && <InfoTip label="About removing an archived question">{ARCHIVED_REMOVAL_NOTE}</InfoTip>}
              </span>
              <Button type="button" variant="destructive" size="sm" disabled={locked} onClick={remove}>
                {dependants.length > 0 ? "Remove question and conditions" : "Remove question"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingRemoval(false)}>
                Keep it
              </Button>
            </div>
          )}
          <div id={rulesId} hidden={!rulesOpen} className="mx-3.5 mb-3.5 ml-[4.25rem]">
            {rulesOpen && (
              <PredicateEditor
                draft={draft}
                item={item}
                position={position}
                disabled={locked}
                onChange={(visibleWhen) => onChange(setVisibleWhen(item.itemId, visibleWhen))}
              />
            )}
          </div>
        </li>
      )}
    </SortableRow>
  );
}
