import { conditionsOf, type Option, type Predicate, type QuestionContent, type ResponseRow } from "@qp/shared";
import { calendarDayLabel } from "../../lib/dates";

const TYPE_LABELS: Record<QuestionContent["type"], string> = {
  text: "Text",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  number: "Number",
  date: "Date",
};

export function questionTypeLabel(type: QuestionContent["type"]): string {
  return TYPE_LABELS[type];
}

export function visibilityRuleLabel(visibleWhen: Predicate | null): string {
  const count = conditionsOf(visibleWhen).length;
  return count === 0 ? "Always shown" : `Shown when ${count} condition${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} true`;
}

function optionLabel(options: readonly Option[], optionId: string): string {
  return options.find((option) => option.optionId === optionId)?.label ?? optionId;
}

function AnswerBox({ label, code, aside }: { label: string; code?: string; aside?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-lg bg-muted px-3 py-2.5">
      <span className="font-medium">{label}</span>
      {code === undefined ? null : (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          stored as <span className="font-mono">{code}</span>
        </span>
      )}
      {aside === undefined ? null : <span className="text-xs whitespace-nowrap text-muted-foreground">{aside}</span>}
    </div>
  );
}

export function AnswerDisplay({ question, answer }: { question: QuestionContent; answer: ResponseRow }) {
  switch (answer.type) {
    case "text":
      return <AnswerBox label={answer.text} />;
    case "number":
      return <AnswerBox label={answer.unit === undefined ? answer.number : `${answer.number} ${answer.unit}`} />;
    case "date":
      return <AnswerBox label={calendarDayLabel(answer.date)} code={answer.date} />;
    case "single_choice":
    case "multiple_choice": {
      const options = question.type === "single_choice" || question.type === "multiple_choice" ? question.options : [];
      return (
        <div className="flex flex-col gap-1">
          {answer.optionIds.map((optionId) => (
            <AnswerBox key={optionId} label={optionLabel(options, optionId)} code={optionId} />
          ))}
          {answer.otherText === undefined ? null : <AnswerBox label={answer.otherText} aside="other, freeform" />}
        </div>
      );
    }
  }
}
