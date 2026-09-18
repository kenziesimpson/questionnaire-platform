import type { Item, QuestionContent } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { DateControl } from "./controls/date-control";
import { MultipleChoiceControl } from "./controls/multiple-choice-control";
import { NumberControl } from "./controls/number-control";
import { SingleChoiceControl } from "./controls/single-choice-control";
import { TextControl } from "./controls/text-control";
import { itemErrorMessage } from "./messages";
import type { RendererProps } from "./types";

function withLabel(question: QuestionContent, label: string | undefined): QuestionContent {
  return label === undefined ? question : { ...question, prompt: label };
}

export function ItemControl({
  item,
  answers,
  errors,
  mode,
  onChange,
  label,
  onClear,
}: RendererProps & { item: Item; label?: string; onClear?: () => void }) {
  const question = withLabel(item.question, label);
  const answer = answers[item.itemId] ?? undefined;
  const shared = { error: itemErrorMessage(errors[item.itemId], question), mode, onChange };

  const control = (() => {
    switch (question.type) {
      case "text":
        return <TextControl item={{ ...item, question }} answer={answer?.type === "text" ? answer : undefined} {...shared} />;
      case "single_choice":
        return (
          <SingleChoiceControl
            item={{ ...item, question }}
            answer={answer?.type === "single_choice" ? answer : undefined}
            {...shared}
          />
        );
      case "multiple_choice":
        return (
          <MultipleChoiceControl
            item={{ ...item, question }}
            answer={answer?.type === "multiple_choice" ? answer : undefined}
            {...shared}
          />
        );
      case "number":
        return <NumberControl item={{ ...item, question }} answer={answer?.type === "number" ? answer : undefined} {...shared} />;
      case "date":
        return <DateControl item={{ ...item, question }} answer={answer?.type === "date" ? answer : undefined} {...shared} />;
      default:
        return question satisfies never;
    }
  })();

  if (!onClear) return control;

  return (
    <div className="flex items-start gap-3">
      <div className="flex-1">{control}</div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={answer === undefined}
        aria-label={`Clear ${question.prompt}`}
      >
        Clear
      </Button>
    </div>
  );
}
