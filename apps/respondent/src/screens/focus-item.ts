const FOCUSABLE_CANDIDATES = 'input:not([type="hidden"]), textarea, select, button, [tabindex]';

function isKeyboardReachable(element: HTMLElement): boolean {
  return element.tabIndex >= 0 && !element.matches(":disabled") && element.closest('[aria-hidden="true"]') === null;
}

function itemWrapper(container: HTMLElement, itemId: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-item-id]")).find((element) => element.dataset.itemId === itemId);
}

export function focusItem(container: HTMLElement, itemId: string): boolean {
  const wrapper = itemWrapper(container, itemId);
  const target = wrapper && Array.from(wrapper.querySelectorAll<HTMLElement>(FOCUSABLE_CANDIDATES)).find(isKeyboardReachable);
  if (wrapper === undefined || target === undefined) return false;
  wrapper.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
  return true;
}
