import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraftItem, Question, QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { useId, useState, type ReactNode } from "react";
import type { DraftChange } from "../../api/use-draft-mutation";
import { isArchived } from "../question-bank/bank-display";
import { GripIcon, RemoveIcon } from "../question-editor/icons";
import { RESPONSE_TYPE_LABELS } from "../question-editor/question-form";
import { laterReferencesIn } from "./conditions";
import {
  conditionsOf,
  dependantsOf,
  moveItem,
  pinnedQuestionOf,
  removeItem,
  repinItem,
  setRequired,
  setVisibleWhen,
} from "./draft-changes";
import { ArrowDownIcon, ArrowUpIcon, RulesIcon } from "./icons";
import { PredicateEditor } from "./predicate-editor";

export function itemDomId(itemId: string) {
  return `draft-item-${itemId}`;
}

interface DraftItemsProps {
  draft: QuestionnaireDraft;
  bank: ReadonlyMap<string, Question>;
  onChange: (apply: DraftChange) => void;
  onEdit: (item: DraftItem) => void;
  editingItemId: string | null;
}

function promptOf(draft: QuestionnaireDraft, item: DraftItem) {
  return pinnedQuestionOf(draft, item)?.prompt ?? "Unknown question";
}

function visibilitySummary(item: DraftItem) {
  const conditions = conditionsOf(item.visibleWhen);
  if (item.visibleWhen === null || conditions.length === 0) return "Always shown";
  if (conditions.length === 1) return "Shown when 1 condition is true";
  return `Shown when ${"all" in item.visibleWhen ? "all" : "any"} of ${conditions.length} conditions are true`;
}

function listOfPositions(positions: readonly number[]) {
  const unique = [...new Set(positions)];
  if (unique.length === 1) return `question ${unique[0]}`;
  return `questions ${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "destructive" }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap ${tone === "destructive" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}
    >
      {children}
    </span>
  );
}

class DragProgress {
  hasMoved = false;
}

function announcementsFor(draft: QuestionnaireDraft, progress: DragProgress): Announcements {
  const total = draft.items.length;
  const positionOf = (id: UniqueIdentifier) => draft.items.findIndex((item) => item.itemId === id) + 1;
  const nameOf = (id: UniqueIdentifier) => {
    const item = draft.items.find((candidate) => candidate.itemId === id);
    return item === undefined ? String(id) : `“${promptOf(draft, item)}”`;
  };
  return {
    onDragStart: ({ active }) => {
      progress.hasMoved = false;
      return `Picked up question ${nameOf(active.id)}. It is in position ${positionOf(active.id)} of ${total}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!progress.hasMoved && over?.id === active.id) return undefined;
      progress.hasMoved = true;
      return over === null
        ? `Question ${nameOf(active.id)} is no longer over the list.`
        : `Question ${nameOf(active.id)} moved to position ${positionOf(over.id)} of ${total}.`;
    },
    onDragEnd: ({ active, over }) =>
      over === null
        ? `Question ${nameOf(active.id)} was dropped back in place.`
        : `Question ${nameOf(active.id)} was dropped in position ${positionOf(over.id)} of ${total}.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. Question ${nameOf(active.id)} went back to position ${positionOf(active.id)} of ${total}.`,
  };
}

const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "To reorder, press Space or Enter to pick up the question, use the up and down arrow keys to move it, then press Space or Enter again to drop it, or Escape to cancel. The Move up and Move down buttons do the same one step at a time.",
};

export function DraftItems({ draft, bank, onChange, onEdit, editingItemId }: DraftItemsProps) {
  const [dragProgress] = useState(() => new DragProgress());
  const [liveRegionContainer, setLiveRegionContainer] = useState<HTMLDivElement | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const total = draft.items.length;

  const drop = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    const to = draft.items.findIndex((item) => item.itemId === over.id);
    onChange(moveItem(String(active.id), to));
  };

  const moveBy = (item: DraftItem, from: number, step: number) => {
    const to = from + step;
    if (to < 0 || to >= total) return;
    onChange(moveItem(item.itemId, to));
    setMoveAnnouncement(`Moved “${promptOf(draft, item)}” to position ${to + 1} of ${total}.`);
  };

  return (
    <div>
      <div ref={setLiveRegionContainer} />
      <p aria-live="polite" className="sr-only">
        {moveAnnouncement}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          announcements: announcementsFor(draft, dragProgress),
          screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
          container: liveRegionContainer ?? undefined,
        }}
        onDragEnd={drop}
      >
        <SortableContext items={draft.items.map(({ itemId }) => itemId)} strategy={verticalListSortingStrategy}>
          <ol aria-label="Questions, in the order respondents see them" className="flex flex-col rounded-xl border border-border">
            {draft.items.map((item, index) => (
              <SortableItemRow
                key={item.itemId}
                draft={draft}
                item={item}
                index={index}
                latest={bank.get(item.questionId)}
                editing={editingItemId === item.itemId}
                onChange={onChange}
                onEdit={() => onEdit(item)}
                onMove={(step) => moveBy(item, index, step)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface ItemRowProps {
  draft: QuestionnaireDraft;
  item: DraftItem;
  index: number;
  latest: Question | undefined;
  editing: boolean;
  onChange: (apply: DraftChange) => void;
  onEdit: () => void;
  onMove: (step: number) => void;
}

function SortableItemRow({ draft, item, index, latest, editing, onChange, onEdit, onMove }: ItemRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.itemId,
  });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const rulesId = useId();
  const requiredId = useId();
  const position = index + 1;
  const total = draft.items.length;
  const question = pinnedQuestionOf(draft, item);
  const prompt = promptOf(draft, item);
  const newer = latest !== undefined && latest.latest.questionVersion > item.questionVersion ? latest.latest : undefined;
  const archived = latest !== undefined && isArchived(latest);
  const later = laterReferencesIn(draft, item);
  const dependants = dependantsOf(draft, item.itemId).map((dependant) => draft.items.indexOf(dependant) + 1);

  const remove = () => {
    if (dependants.length > 0 && !confirmingRemoval) {
      setConfirmingRemoval(true);
      return;
    }
    onChange(removeItem(item.itemId));
  };

  return (
    <li
      ref={setNodeRef}
      id={itemDomId(item.itemId)}
      tabIndex={-1}
      data-item-id={item.itemId}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex flex-col border-b border-border outline-none first:rounded-t-xl last:rounded-b-xl last:border-b-0 focus-visible:ring-3 focus-visible:ring-ring/50 ${rulesOpen ? "bg-muted" : "bg-background"} ${isDragging ? "relative z-10 shadow-lg ring-1 ring-foreground/10" : ""}`}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Drag to reorder question ${position}`}
          className="inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
        <span aria-hidden="true" className="w-4 shrink-0 pt-1 font-mono text-xs text-muted-foreground">
          {position}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="pt-0.5 font-medium">{prompt}</span>
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
              onClick={() => setRulesOpen((open) => !open)}
            >
              <RulesIcon />
              Rules
            </Button>
            {archived && <Badge tone="destructive">Archived in bank</Badge>}
            {newer !== undefined && (
              <span className="flex items-center gap-1.5">
                <Badge>v{newer.questionVersion} in bank</Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={`Re-pin question ${position} to version ${newer.questionVersion}`}
                  onClick={() => onChange(repinItem(item.itemId, newer))}
                >
                  Use v{newer.questionVersion}
                </Button>
              </span>
            )}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mr-1.5"
            aria-label={`Edit question ${position}`}
            disabled={editing}
            onClick={onEdit}
          >
            {editing ? "Opening…" : "Edit"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move question ${position} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move question ${position} down`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove question ${position}`} onClick={remove}>
            <RemoveIcon />
          </Button>
        </span>
      </div>
      {confirmingRemoval && (
        <div role="alert" className="mx-3.5 mb-3 ml-[4.25rem] flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]">
          <span className="flex-1">
            Conditions on {listOfPositions(dependants)} use this question. Removing it removes those conditions too.
          </span>
          <Button type="button" variant="destructive" size="sm" onClick={remove}>
            Remove question and conditions
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
            onChange={(visibleWhen) => onChange(setVisibleWhen(item.itemId, visibleWhen))}
          />
        )}
      </div>
    </li>
  );
}
