import type { Condition, ConditionOf, DraftItem, Option, Predicate, QuestionVersion, QuestionnaireDraft } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { Input } from "@qp/ui/primitives/input";
import { useId, useState, type KeyboardEvent } from "react";
import { PlusIcon, RemoveIcon } from "../../components/icons";
import { DECIMAL_INPUT_PATTERN } from "../question-editor/question-form";
import {
  OPERATOR_LABELS,
  UNSET_DATE,
  defaultConditionFor,
  earlierItemsThan,
  isComplete,
  operatorsFor,
  referenceOf,
  withOperator,
  type Operator,
} from "./conditions";
import { conditionsOf } from "./draft-changes";
import { NativeSelect } from "./native-select";

interface PredicateEditorProps {
  draft: QuestionnaireDraft;
  item: DraftItem;
  position: number;
  disabled: boolean;
  onChange: (visibleWhen: Predicate | null) => void;
}

type Combinator = "all" | "any";

function predicateOf(combinator: Combinator, conditions: Condition[]): Predicate | null {
  if (conditions.length === 0) return null;
  return combinator === "all" ? { all: conditions } : { any: conditions };
}

function promptLabel(position: number, prompt: string) {
  return `${position}. ${prompt}`;
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
            className="w-20"
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

interface ConditionRowProps {
  number: number;
  draft: QuestionnaireDraft;
  dependant: DraftItem;
  saved: Condition;
  onCommit: (condition: Condition) => void;
  onRemove: () => void;
}

function RemoveConditionButton({ number, onRemove }: { number: number; onRemove: () => void }) {
  return (
    <Button type="button" variant="outline" size="icon-sm" aria-label={`Remove condition ${number}`} onClick={onRemove}>
      <RemoveIcon />
    </Button>
  );
}

function sameCondition(a: Condition, b: Condition) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ConditionRow({ number, draft, dependant, saved, onCommit, onRemove }: ConditionRowProps) {
  const warningId = useId();
  const incompleteId = useId();
  const [editing, setEditing] = useState<Condition | null>(null);
  const condition = editing ?? saved;
  const reference = referenceOf(draft, dependant.itemId, condition);
  const earlier = earlierItemsThan(draft, dependant.itemId);
  const incomplete = !isComplete(condition);

  const update = (next: Condition) => {
    if (!isComplete(next)) {
      setEditing(next);
      return;
    }
    setEditing(null);
    if (!sameCondition(next, saved)) onCommit(next);
  };

  if (reference.kind === "unusable") {
    return (
      <li className="flex items-center gap-2">
        <p className="flex-1 text-sm text-destructive">
          {reference.reason === "missing"
            ? `Condition ${number} refers to a question that is no longer in this draft.`
            : `Condition ${number} refers to question ${reference.position}, whose response type no longer matches.`}
        </p>
        <RemoveConditionButton number={number} onRemove={onRemove} />
      </li>
    );
  }

  const { question } = reference;
  const isLater = reference.kind === "later";

  return (
    <li className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(9rem,1fr)_8.5rem_minmax(10rem,auto)_auto] items-start gap-2">
        <NativeSelect
          aria-label={`Condition ${number}: question`}
          aria-invalid={isLater || undefined}
          aria-describedby={isLater ? warningId : undefined}
          className="w-full"
          value={condition.itemId}
          onChange={(event) => {
            const picked = earlier.find(({ item }) => item.itemId === event.target.value);
            if (picked !== undefined) update(defaultConditionFor(picked.item.itemId, picked.question));
          }}
        >
          {earlier.map(({ item, position, question: earlierQuestion }) => (
            <option key={item.itemId} value={item.itemId}>
              {promptLabel(position, earlierQuestion.prompt)}
            </option>
          ))}
          {isLater && (
            <option value={condition.itemId} disabled>
              {`${promptLabel(reference.position, question.prompt)} (now below this question)`}
            </option>
          )}
        </NativeSelect>
        <NativeSelect
          aria-label={`Condition ${number}: operator`}
          className="w-full"
          value={condition.op}
          onChange={(event) => {
            const op = operatorsFor(condition.type).find((candidate) => candidate === event.target.value);
            if (op !== undefined) update(withOperator(condition, op));
          }}
        >
          {operatorsFor(condition.type).map((op: Operator) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </NativeSelect>
        <Operand
          number={number}
          condition={condition}
          question={question}
          describedBy={incomplete ? incompleteId : undefined}
          onChange={update}
        />
        <RemoveConditionButton number={number} onRemove={onRemove} />
      </div>
      {isLater && (
        <p id={warningId} className="text-xs text-destructive">
          Question {reference.position} is now below this one, so this condition cannot be used. Move that question back
          above, or choose an earlier one.
        </p>
      )}
      {incomplete && (
        <p id={incompleteId} className="text-xs text-muted-foreground">
          Not saved yet. Enter a value to save this condition.
        </p>
      )}
    </li>
  );
}

interface OperandProps {
  number: number;
  condition: Condition;
  question: QuestionVersion;
  describedBy: string | undefined;
  onChange: (condition: Condition) => void;
}

function Operand({ number, condition, question, describedBy, onChange }: OperandProps) {
  const label = `Condition ${number}: value`;
  switch (condition.type) {
    case "text":
      return (
        <NativeSelect
          aria-label={label}
          className="w-full"
          value={condition.value ? "answered" : "unanswered"}
          onChange={(event) => onChange({ ...condition, value: event.target.value === "answered" })}
        >
          <option value="answered">answered</option>
          <option value="unanswered">not answered</option>
        </NativeSelect>
      );
    case "single_choice":
    case "multiple_choice":
      return (
        <ChoiceOperand
          label={label}
          condition={condition}
          options={"options" in question ? question.options : []}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <NumberOperands
          label={label}
          condition={condition}
          unit={"unit" in question ? question.unit : undefined}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
    case "date":
      return <DateOperands label={label} condition={condition} describedBy={describedBy} onChange={onChange} />;
  }
}

type ChoiceCondition = ConditionOf<"single_choice"> | ConditionOf<"multiple_choice">;

function ChoiceOperand({
  label,
  condition,
  options,
  onChange,
}: {
  label: string;
  condition: ChoiceCondition;
  options: readonly Option[];
  onChange: (condition: Condition) => void;
}) {
  if ("optionId" in condition) {
    const known = options.some(({ optionId }) => optionId === condition.optionId);
    return (
      <NativeSelect
        aria-label={label}
        className="w-full"
        value={condition.optionId}
        onChange={(event) => onChange({ ...condition, optionId: event.target.value })}
      >
        {!known && (
          <option value={condition.optionId} disabled>
            {`Unknown option ${condition.optionId}`}
          </option>
        )}
        {options.map(({ optionId, label: optionLabel }) => (
          <option key={optionId} value={optionId}>
            {optionLabel}
          </option>
        ))}
      </NativeSelect>
    );
  }
  const knownIds = options.map((option) => option.optionId);
  const checkedKnown = knownIds.filter((id) => condition.optionIds.includes(id));
  const unknownIds = condition.optionIds.filter((id) => !knownIds.includes(id));
  const toggle = (optionId: string, checked: boolean) => {
    const next = checked ? knownIds.filter((id) => id === optionId || checkedKnown.includes(id)) : checkedKnown.filter((id) => id !== optionId);
    if (next.length > 0) onChange({ ...condition, optionIds: next });
  };
  return (
    <fieldset className="flex min-w-44 flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">
      <legend className="sr-only">{label}</legend>
      {unknownIds.map((optionId) => (
        <OptionCheckbox key={optionId} label="Unknown option" checked disabled onChecked={() => undefined} />
      ))}
      {options.map(({ optionId, label: optionLabel }) => (
        <OptionCheckbox
          key={optionId}
          label={optionLabel}
          checked={checkedKnown.includes(optionId)}
          disabled={checkedKnown.length === 1 && checkedKnown[0] === optionId}
          onChecked={(checked) => toggle(optionId, checked)}
        />
      ))}
    </fieldset>
  );
}

function OptionCheckbox({
  label,
  checked,
  disabled,
  onChecked,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChecked: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-1.5">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(next) => onChecked(next === true)} />
      <label htmlFor={id} className="text-sm peer-disabled:opacity-80">
        {label}
      </label>
    </span>
  );
}

function commitOnEnter(commit: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  };
}

const numberText = (value: number) => (Number.isFinite(value) ? String(value) : "");

function describedByAll(...ids: (string | undefined)[]) {
  const present = ids.filter((id) => id !== undefined);
  return present.length === 0 ? undefined : present.join(" ");
}

function NumberInput({
  label,
  value,
  describedBy,
  onCommit,
}: {
  label: string;
  value: number;
  describedBy: string | undefined;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(numberText(value));
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setText(numberText(value));
      return;
    }
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <Input
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={!Number.isFinite(value) || undefined}
      inputMode="decimal"
      className="w-20"
      value={text}
      onChange={(event) => {
        if (DECIMAL_INPUT_PATTERN.test(event.target.value)) setText(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={commitOnEnter(commit)}
    />
  );
}

function Unit({ id, unit }: { id: string; unit: string | undefined }) {
  return unit === undefined ? null : (
    <span id={id} className="self-center text-sm text-muted-foreground">
      {unit}
    </span>
  );
}

const upperOf = (low: number, high: number) => (Number.isFinite(high) ? Math.max(low, high) : high);
const lowerOf = (high: number, low: number) => (Number.isFinite(low) ? Math.min(high, low) : low);

function NumberOperands({
  label,
  condition,
  unit,
  describedBy,
  onChange,
}: {
  label: string;
  condition: ConditionOf<"number">;
  unit: string | undefined;
  describedBy: string | undefined;
  onChange: (condition: Condition) => void;
}) {
  const unitId = useId();
  const description = describedByAll(unit === undefined ? undefined : unitId, describedBy);
  if (condition.op !== "between") {
    return (
      <span className="flex gap-2">
        <NumberInput
          key={condition.value}
          label={label}
          value={condition.value}
          describedBy={description}
          onCommit={(value) => onChange({ ...condition, value })}
        />
        <Unit id={unitId} unit={unit} />
      </span>
    );
  }
  return (
    <span className="flex gap-2">
      <NumberInput
        key={`min-${condition.min}`}
        label={`${label}, lowest`}
        value={condition.min}
        describedBy={description}
        onCommit={(min) => onChange({ ...condition, min, max: upperOf(min, condition.max) })}
      />
      <span className="self-center text-sm text-muted-foreground">and</span>
      <NumberInput
        key={`max-${condition.max}`}
        label={`${label}, highest`}
        value={condition.max}
        describedBy={description}
        onCommit={(max) => onChange({ ...condition, max, min: lowerOf(max, condition.min) })}
      />
      <Unit id={unitId} unit={unit} />
    </span>
  );
}

function DateInput({
  label,
  value,
  describedBy,
  onCommit,
}: {
  label: string;
  value: string;
  describedBy: string | undefined;
  onCommit: (value: string) => void;
}) {
  return (
    <Input
      type="date"
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={value === UNSET_DATE || undefined}
      className="w-40"
      value={value}
      onChange={(event) => {
        if (event.target.value !== UNSET_DATE) onCommit(event.target.value);
      }}
    />
  );
}

const laterDate = (low: string, high: string) => (high !== UNSET_DATE && low > high ? low : high);
const earlierDate = (high: string, low: string) => (low !== UNSET_DATE && high < low ? high : low);

function DateOperands({
  label,
  condition,
  describedBy,
  onChange,
}: {
  label: string;
  condition: ConditionOf<"date">;
  describedBy: string | undefined;
  onChange: (condition: Condition) => void;
}) {
  if (condition.op !== "between") {
    return (
      <DateInput label={label} value={condition.date} describedBy={describedBy} onCommit={(date) => onChange({ ...condition, date })} />
    );
  }
  return (
    <span className="flex gap-2">
      <DateInput
        label={`${label}, earliest`}
        value={condition.min}
        describedBy={describedBy}
        onCommit={(min) => onChange({ ...condition, min, max: laterDate(min, condition.max) })}
      />
      <span className="self-center text-sm text-muted-foreground">and</span>
      <DateInput
        label={`${label}, latest`}
        value={condition.max}
        describedBy={describedBy}
        onCommit={(max) => onChange({ ...condition, max, min: earlierDate(max, condition.min) })}
      />
    </span>
  );
}
