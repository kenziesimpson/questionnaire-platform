import type { Item } from "@qp/shared";

export function ControlNotChosen({ item }: { item: Item }) {
  return (
    <div className="grid gap-2" data-control-not-chosen={item.question.type}>
      <p className="text-sm font-medium">{item.question.prompt}</p>
    </div>
  );
}
