import { optionIdsOf, type ClientAnswerValue, type ClientAnswerValueOf, type Item, type QuestionOf, type ResponseType } from "@qp/shared";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { Input } from "@qp/ui/primitives/input";
import { Label } from "@qp/ui/primitives/label";
import { RadioGroup, RadioGroupItem } from "@qp/ui/primitives/radio-group";
import type { AnswerChangeHandler } from "@qp/ui/questionnaire";
import { useId, type ReactNode } from "react";

const UNANSWERED_CHOICE = "(unanswered)";

interface SampleProps<T extends ResponseType> {
  itemId: string;
  label: string;
  question: QuestionOf<T>;
  answer: ClientAnswerValueOf<T> | undefined;
  onChange: AnswerChangeHandler;
}

function TextSample({ itemId, label, answer, onChange }: SampleProps<"text">) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        value={answer?.text ?? ""}
        onChange={(event) => onChange(itemId, event.target.value ? { type: "text", text: event.target.value } : null)}
      />
    </div>
  );
}

function NumberSample({ itemId, label, question, answer, onChange }: SampleProps<"number">) {
  const id = useId();
  const unitId = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode={question.numberKind === "integer" ? "numeric" : "decimal"}
          className="max-w-40"
          value={answer?.value ?? ""}
          aria-describedby={question.unit === undefined ? undefined : unitId}
          onChange={(event) =>
            onChange(itemId, event.target.value ? { type: "number", value: event.target.value } : null)
          }
        />
        {question.unit !== undefined && (
          <span id={unitId} className="text-sm text-muted-foreground">
            {question.unit}
          </span>
        )}
      </div>
    </div>
  );
}

function DateSample({ itemId, label, answer, onChange }: SampleProps<"date">) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        className="w-auto"
        value={answer?.date ?? ""}
        onChange={(event) => onChange(itemId, event.target.value ? { type: "date", date: event.target.value } : null)}
      />
    </div>
  );
}

function SampleFieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2.5">
      <legend className="mb-2.5 text-sm leading-none font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

function SingleChoiceSample({ itemId, label, question, answer, onChange }: SampleProps<"single_choice">) {
  const baseId = useId();
  const choices = [
    ...question.options.map(({ optionId, label: optionLabel }) => ({ value: optionId, label: optionLabel })),
    { value: UNANSWERED_CHOICE, label: "Unanswered" },
  ];
  return (
    <SampleFieldset legend={label}>
      <RadioGroup
        value={answer?.optionId ?? UNANSWERED_CHOICE}
        onValueChange={(value) =>
          onChange(itemId, value === UNANSWERED_CHOICE ? null : { type: "single_choice", optionId: value })
        }
      >
        {choices.map((choice, index) => {
          const id = `${baseId}-${index}`;
          return (
            <div key={choice.value} className="flex items-center gap-2.5">
              <RadioGroupItem id={id} value={choice.value} />
              <Label htmlFor={id} className="font-normal">
                {choice.label}
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </SampleFieldset>
  );
}

function MultipleChoiceSample({ itemId, label, question, answer, onChange }: SampleProps<"multiple_choice">) {
  const baseId = useId();
  const selected = new Set(answer?.optionIds ?? []);

  function toggle(optionId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(optionId);
    else next.delete(optionId);
    const optionIds = optionIdsOf(question).filter((id) => next.has(id));
    onChange(itemId, optionIds.length === 0 ? null : { type: "multiple_choice", optionIds });
  }

  return (
    <SampleFieldset legend={label}>
      {question.options.map((option) => {
        const id = `${baseId}-${option.optionId}`;
        return (
          <div key={option.optionId} className="flex items-center gap-2.5">
            <Checkbox
              id={id}
              checked={selected.has(option.optionId)}
              onCheckedChange={(checked) => toggle(option.optionId, checked === true)}
            />
            <Label htmlFor={id} className="font-normal">
              {option.label}
            </Label>
          </div>
        );
      })}
    </SampleFieldset>
  );
}

export interface SampleAnswerInputProps {
  item: Item;
  label: string;
  answer: ClientAnswerValue | undefined;
  onChange: AnswerChangeHandler;
}

export function SampleAnswerInput({ item, label, answer, onChange }: SampleAnswerInputProps) {
  const { itemId, question } = item;
  const shared = { itemId, label, onChange };
  switch (question.type) {
    case "text":
      return <TextSample {...shared} question={question} answer={answer?.type === "text" ? answer : undefined} />;
    case "single_choice":
      return (
        <SingleChoiceSample
          {...shared}
          question={question}
          answer={answer?.type === "single_choice" ? answer : undefined}
        />
      );
    case "multiple_choice":
      return (
        <MultipleChoiceSample
          {...shared}
          question={question}
          answer={answer?.type === "multiple_choice" ? answer : undefined}
        />
      );
    case "number":
      return <NumberSample {...shared} question={question} answer={answer?.type === "number" ? answer : undefined} />;
    case "date":
      return <DateSample {...shared} question={question} answer={answer?.type === "date" ? answer : undefined} />;
    default:
      return question satisfies never;
  }
}
