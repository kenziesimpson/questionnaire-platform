import { useState } from "react";
import type { Item } from "@qp/shared";

function sameItems(a: readonly Item[], b: readonly Item[]): boolean {
  return a.length === b.length && a.every((item, index) => item.itemId === b[index]?.itemId);
}

function without(items: readonly Item[], present: readonly Item[]): Item[] {
  const ids = new Set(present.map((item) => item.itemId));
  return items.filter((item) => !ids.has(item.itemId));
}

function phrase(items: readonly Item[], verb: string): string | null {
  if (items.length === 0) return null;
  const noun = items.length === 1 ? "question" : "questions";
  return `${items.length} ${noun} ${verb}: ${items.map((item) => item.question.prompt).join("; ")}.`;
}

export function describeVisibilityChange(before: readonly Item[], after: readonly Item[]): string {
  return [phrase(without(after, before), "added"), phrase(without(before, after), "removed")]
    .filter((part) => part !== null)
    .join(" ");
}

function useVisibilityAnnouncement(items: readonly Item[]): string {
  const [previous, setPrevious] = useState(items);
  const [announcement, setAnnouncement] = useState("");
  if (!sameItems(previous, items)) {
    setPrevious(items);
    const change = describeVisibilityChange(previous, items);
    if (change) setAnnouncement(change);
  }
  return announcement;
}

export function VisibilityAnnouncer({ items }: { items: readonly Item[] }) {
  const announcement = useVisibilityAnnouncement(items);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
