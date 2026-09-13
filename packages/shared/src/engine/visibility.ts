import { answerFor, type ClientAnswers } from "../domain/answer.js";
import type { Item } from "../domain/definition.js";
import { predicateHolds, type ReferencedItem } from "./conditions.js";

export interface HasItems {
  items: readonly Item[];
}

export function evaluateVisibility(definition: HasItems, answers: ClientAnswers): ReadonlySet<string> {
  const shown = new Set<string>();
  const reference = (itemId: string): ReferencedItem => ({
    shown: shown.has(itemId),
    answer: answerFor(answers, itemId),
  });
  for (const item of definition.items) {
    if (predicateHolds(item.visibleWhen, reference)) shown.add(item.itemId);
  }
  return shown;
}

export function visibleItems(definition: HasItems, answers: ClientAnswers): Item[] {
  const shown = evaluateVisibility(definition, answers);
  return definition.items.filter((item) => shown.has(item.itemId));
}

export function visibleAnswers(definition: HasItems, answers: ClientAnswers): ClientAnswers {
  const kept: ClientAnswers = {};
  for (const item of visibleItems(definition, answers)) {
    const answer = answerFor(answers, item.itemId);
    if (answer !== undefined) kept[item.itemId] = answer;
  }
  return kept;
}
