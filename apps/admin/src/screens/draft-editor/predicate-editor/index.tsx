import { conditionsOf, type Condition, type DraftItem, type Predicate, type QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { NativeSelect } from "@qp/ui/primitives/native-select";
import { useId, useState } from "react";
import { PlusIcon } from "../../../components/icons";
import { defaultConditionFor, isComplete } from "../conditions";
import { earlierItemsThan } from "../draft-selectors";
import { ConditionRow } from "./condition-row";

interface PredicateEditorProps {
  draft: QuestionnaireDraft;
  item: DraftItem;
  position: number;
  disabled: boolean;
  onChange: (visibleWhen: Predicate | null) => void;
}

type Combinator = "all" | "any";

function predicateOf(combinator: Combinator, conditions: readonly Condition[]): Predicate | null {
  if (conditions.length === 0) return null;
  return combinator === "all" ? { all: [...conditions] } : { any: [...conditions] };
}

export function PredicateEditor({ draft, item, position, disabled, onChange }: PredicateEditorProps) {
  const [unsaved, setUnsaved] = useState<Condition | null>(null);
  const legendId = useId();
  const hintId = useId();
  const conditions = conditionsOf(item.visibleWhen);
  const combinator: Combinator = item.visibleWhen !== null && "any" in item.visibleWhen ? "any" : "all";
  const earlier = earlierItemsThan(draft, item.itemId);
  const nearest = earlier.at(-1);

  const replaceAt = (index: number, next: Condition) =>
    onChange(predicateOf(combinator, conditions.map((condition, at) => (at === index ? next : condition))));

  const append = (added: Condition) => {
    setUnsaved(null);
    onChange(predicateOf(combinator, [...conditions, added]));
  };

  const addCondition = () => {
    if (nearest === undefined) return;
    const added = defaultConditionFor(nearest.item.itemId, nearest.question);
    if (isComplete(added)) append(added);
    else setUnsaved(added);
  };

  return (
    <fieldset
      data-rules-editor
      tabIndex={-1}
      aria-labelledby={legendId}
      aria-describedby={hintId}
      disabled={disabled}
      className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-background p-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <legend id={legendId} className="sr-only">
        Rules for question {position}
      </legend>
      {conditions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {unsaved === null
            ? "Always shown. Add a condition to show it only after certain answers."
            : "Always shown until this condition is saved."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span>Shown when</span>
          <NativeSelect
            aria-label="Which conditions must be true"
            className="w-20 min-w-0"
            value={combinator}
            onChange={(event) => onChange(predicateOf(event.target.value === "any" ? "any" : "all", conditions))}
          >
            <option value="all">all</option>
            <option value="any">any</option>
          </NativeSelect>
          <span>of these are true</span>
        </div>
      )}
      {(conditions.length > 0 || unsaved !== null) && (
        <ul aria-label={`Conditions for question ${position}`} className="flex flex-col gap-2">
          {conditions.map((condition, index) => (
            <ConditionRow
              key={`${index}-${condition.itemId}`}
              number={index + 1}
              draft={draft}
              dependant={item}
              saved={condition}
              onCommit={(next) => replaceAt(index, next)}
              onRemove={() => onChange(predicateOf(combinator, conditions.filter((_, at) => at !== index)))}
            />
          ))}
          {unsaved !== null && (
            <ConditionRow
              key="unsaved"
              number={conditions.length + 1}
              draft={draft}
              dependant={item}
              saved={unsaved}
              onCommit={append}
              onRemove={() => setUnsaved(null)}
            />
          )}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" disabled={nearest === undefined || unsaved !== null} onClick={addCondition}>
          <PlusIcon />
          Add condition
        </Button>
        <span id={hintId} className="text-xs text-muted-foreground">
          {nearest === undefined
            ? "The first question has no earlier answers to depend on."
            : "Only questions above this one, and only operators their type allows."}
        </span>
      </div>
    </fieldset>
  );
}
