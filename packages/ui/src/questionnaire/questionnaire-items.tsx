import type { Item } from "@qp/shared";
import { ItemControl } from "./item-control";
import type { RendererProps } from "./types";
import { VisibilityAnnouncer } from "./visibility-announcer";

export interface QuestionnaireItemsProps extends RendererProps {
  visibleItems: readonly Item[];
}

export function QuestionnaireItems({ visibleItems, ...renderer }: QuestionnaireItemsProps) {
  return (
    <div className="flex flex-col gap-6">
      {visibleItems.map((item) => (
        <div key={item.itemId} data-item-id={item.itemId}>
          <ItemControl item={item} {...renderer} />
        </div>
      ))}
      <VisibilityAnnouncer items={visibleItems} />
    </div>
  );
}
