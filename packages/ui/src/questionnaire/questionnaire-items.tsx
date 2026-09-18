import type { Item } from "@qp/shared";
import { ItemControl } from "./item-control";
import { ITEM_ID_ATTRIBUTE } from "./item-id-attribute";
import type { RendererProps } from "./types";
import { VisibilityAnnouncer } from "./visibility-announcer";

export interface QuestionnaireItemsProps extends RendererProps {
  visibleItems: readonly Item[];
  labelFor?: (item: Item, index: number) => string;
  onClear?: (itemId: string) => void;
}

export function QuestionnaireItems({ visibleItems, labelFor, onClear, ...renderer }: QuestionnaireItemsProps) {
  return (
    <div className="flex flex-col gap-6">
      {visibleItems.map((item, index) => (
        <div key={item.itemId} {...{ [ITEM_ID_ATTRIBUTE]: item.itemId }}>
          <ItemControl
            item={item}
            {...renderer}
            label={labelFor?.(item, index)}
            onClear={onClear && (() => onClear(item.itemId))}
          />
        </div>
      ))}
      <VisibilityAnnouncer items={visibleItems} />
    </div>
  );
}
