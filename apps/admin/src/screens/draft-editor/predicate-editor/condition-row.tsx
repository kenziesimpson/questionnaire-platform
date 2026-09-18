import {
  OPERATORS_BY_TYPE,
  isChoiceQuestion,
  type Condition,
  type DraftItem,
  type QuestionVersion,
  type QuestionnaireDraft,
} from "@qp/shared";
import { NativeSelect } from "@qp/ui/primitives/native-select";
import { Button } from "@qp/ui/primitives/button";
import { useId, useState } from "react";
import { RemoveIcon } from "../../../components/icons";
import { defaultConditionFor, isComplete, OPERATOR_LABELS, withOperator, type Operator } from "../conditions";
import { earlierItemsThan, referenceOf } from "../draft-selectors";
import { ChoiceOperand } from "./choice-operand";
import { DateOperands } from "./date-operands";
import { NumberOperands } from "./number-operands";

export function promptLabel(position: number, prompt: string) {
  return `${position}. ${prompt}`;
}

function sameCondition(a: Condition, b: Condition) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type ConditionStep =
  | { kind: "editing"; condition: Condition }
  | { kind: "settled" }
  | { kind: "commit"; condition: Condition };

export function stepCondition(saved: Condition, next: Condition): ConditionStep {
  if (!isComplete(next)) return { kind: "editing", condition: next };
  if (sameCondition(next, saved)) return { kind: "settled" };
  return { kind: "commit", condition: next };
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
          className="w-full min-w-0"
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
          options={isChoiceQuestion(question) ? question.options : []}
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

export function ConditionRow({ number, draft, dependant, saved, onCommit, onRemove }: ConditionRowProps) {
  const warningId = useId();
  const incompleteId = useId();
  const [editing, setEditing] = useState<Condition | null>(null);
  const condition = editing ?? saved;
  const reference = referenceOf(draft, dependant.itemId, condition);
  const earlier = earlierItemsThan(draft, dependant.itemId);
  const incomplete = !isComplete(condition);
  const operators: readonly Operator[] = OPERATORS_BY_TYPE[condition.type];

  const update = (next: Condition) => {
    const step = stepCondition(saved, next);
    switch (step.kind) {
      case "editing":
        setEditing(step.condition);
        return;
      case "settled":
        setEditing(null);
        return;
      case "commit":
        setEditing(null);
        onCommit(step.condition);
        return;
    }
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
          className="w-full min-w-0"
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
          className="w-full min-w-0"
          value={condition.op}
          onChange={(event) => {
            const op = operators.find((candidate) => candidate === event.target.value);
            if (op !== undefined) update(withOperator(condition, op));
          }}
        >
          {operators.map((op) => (
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
