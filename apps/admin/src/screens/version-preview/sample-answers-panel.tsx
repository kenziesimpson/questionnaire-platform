import { answerFor, type ClientAnswers, type Item } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import type { AnswerChangeHandler } from "@qp/ui/questionnaire";
import { useId } from "react";
import { SampleAnswerInput } from "./sample-answer-input";

export interface NumberedItem {
  item: Item;
  label: string;
}

export function numberedItems(items: readonly Item[]): NumberedItem[] {
  return items.map((item, index) => ({ item, label: `${index + 1}. ${item.question.prompt}` }));
}

function hasAnyAnswer(answers: ClientAnswers): boolean {
  return Object.values(answers).some((answer) => answer !== null);
}

export interface SampleAnswersPanelProps {
  shownItems: readonly NumberedItem[];
  answers: ClientAnswers;
  onChange: AnswerChangeHandler;
  onReset: () => void;
}

export function SampleAnswersPanel({ shownItems, answers, onChange, onReset }: SampleAnswersPanelProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold">
          Sample answers
        </h2>
        <Button variant="outline" size="sm" onClick={onReset} disabled={!hasAnyAnswer(answers)}>
          Reset answers
        </Button>
      </div>
      <div className="flex flex-col gap-5">
        {shownItems.map(({ item, label }) => (
          <SampleAnswerInput
            key={item.itemId}
            item={item}
            label={label}
            answer={answerFor(answers, item.itemId)}
            onChange={onChange}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        These never leave the browser. They drive the rules so an author can walk every branch.
      </p>
    </section>
  );
}
