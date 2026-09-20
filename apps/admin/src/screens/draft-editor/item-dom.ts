export function itemDomId(itemId: string) {
  return `draft-item-${itemId}`;
}

export function rulesEditorOf(itemId: string): HTMLElement | null {
  return document.getElementById(itemDomId(itemId))?.querySelector<HTMLElement>("[data-rules-editor]") ?? null;
}
