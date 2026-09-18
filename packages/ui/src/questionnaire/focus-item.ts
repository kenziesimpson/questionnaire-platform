import { ITEM_ID_ATTRIBUTE } from "./item-id-attribute";

const FOCUSABLE_CANDIDATES = 'input:not([type="hidden"]), textarea, select, button, [tabindex]';

function isKeyboardReachable(element: HTMLElement): boolean {
  return element.tabIndex >= 0 && !element.matches(":disabled") && element.closest('[aria-hidden="true"]') === null;
}

function itemWrapper(container: HTMLElement, itemId: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(`[${ITEM_ID_ATTRIBUTE}]`)).find(
    (element) => element.getAttribute(ITEM_ID_ATTRIBUTE) === itemId,
  );
}

export function focusItem(container: HTMLElement, itemId: string): boolean {
  const wrapper = itemWrapper(container, itemId);
  const target = wrapper && Array.from(wrapper.querySelectorAll<HTMLElement>(FOCUSABLE_CANDIDATES)).find(isKeyboardReachable);
  if (wrapper === undefined || target === undefined) return false;
  wrapper.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
  return true;
}
