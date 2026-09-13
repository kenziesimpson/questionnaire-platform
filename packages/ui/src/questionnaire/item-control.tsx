import type { Item } from "@qp/shared";
import { ControlNotChosen } from "./controls/control-not-chosen";
import { DateControl } from "./controls/date-control";
import type { RendererProps } from "./types";

export function ItemControl({ item, answers, errors, mode, onChange }: RendererProps & { item: Item }) {
  const { question } = item;
  const answer = answers[item.itemId] ?? undefined;
  const error = errors[item.itemId];
  switch (question.type) {
    case "date":
      return (
        <DateControl
          item={{ ...item, question }}
          answer={answer?.type === "date" ? answer : undefined}
          error={error}
          mode={mode}
          onChange={onChange}
        />
      );
    case "text":
    case "single_choice":
    case "multiple_choice":
    case "number":
      return <ControlNotChosen item={item} />;
    default:
      return question satisfies never;
  }
}
