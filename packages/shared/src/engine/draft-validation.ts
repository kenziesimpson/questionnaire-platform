import type { Condition, Predicate } from "../domain/condition.js";
import type { DraftItem } from "../domain/draft.js";
import type { QuestionContent } from "../domain/question.js";
import { DRAFT_ITEM_CODES, type DraftItemCode, type ItemError } from "../problems.js";
import { type ConstraintTerm, isTermSatisfiable, mergeTerms, termKey, termOf } from "./satisfiability.js";

export interface DraftForValidation {
  items: readonly DraftItem[];
  questions: readonly QuestionContent[];
  archivedQuestionIds?: ReadonlySet<string>;
}

export interface DraftValidation {
  valid: boolean;
  items: ItemError<DraftItemCode>[];
}

interface Slot {
  index: number;
  itemId: string;
  questionId: string;
  visibleWhen: Predicate | null;
  question: QuestionContent | undefined;
}

type ConditionCheck = DraftItemCode | "referenced-question-unknown" | undefined;

function questionKey(questionId: string, questionVersion: number): string {
  return `${questionId}:${questionVersion}`;
}

function conditionsOf(predicate: Predicate | null): readonly Condition[] {
  if (predicate === null) return [];
  return "all" in predicate ? predicate.all : predicate.any;
}

const REACHABILITY_TERM_BUDGET = 4096;

function referencedOptionIds(condition: Condition): readonly string[] {
  if ("optionId" in condition) return [condition.optionId];
  if ("optionIds" in condition) return condition.optionIds;
  return [];
}

class DraftValidator {
  readonly #slots: Slot[];
  readonly #firstIndexById = new Map<string, number>();
  readonly #archivedQuestionIds: ReadonlySet<string>;
  readonly #errors = new Map<string, ItemError<DraftItemCode> & { index: number }>();
  readonly #reachability = new Map<number, ConstraintTerm[] | undefined>();

  constructor(draft: DraftForValidation) {
    const questions = new Map(draft.questions.map((q) => [questionKey(q.questionId, q.questionVersion), q]));
    this.#slots = draft.items.map((item, index) => ({
      index,
      itemId: item.itemId,
      questionId: item.questionId,
      visibleWhen: item.visibleWhen,
      question: questions.get(questionKey(item.questionId, item.questionVersion)),
    }));
    this.#archivedQuestionIds = draft.archivedQuestionIds ?? new Set();
    for (const slot of this.#slots) {
      if (!this.#firstIndexById.has(slot.itemId)) this.#firstIndexById.set(slot.itemId, slot.index);
    }
  }

  validate(): DraftValidation {
    this.#checkPlacements();
    const wellFormed = this.#slots.filter((slot) => this.#checkReferences(slot));
    for (const slot of wellFormed) this.#checkSatisfiability(slot);
    const items = [...this.#errors.values()]
      .sort((a, b) => a.index - b.index || DRAFT_ITEM_CODES.indexOf(a.code) - DRAFT_ITEM_CODES.indexOf(b.code))
      .map(({ itemId, code }) => ({ itemId, code }));
    return { valid: items.length === 0, items };
  }

  #report(slot: Slot, code: DraftItemCode): void {
    const key = `${slot.itemId}\u0000${code}`;
    if (!this.#errors.has(key)) this.#errors.set(key, { itemId: slot.itemId, code, index: slot.index });
  }

  #checkPlacements(): void {
    const placedQuestionIds = new Set<string>();
    for (const slot of this.#slots) {
      if (this.#firstIndexById.get(slot.itemId) !== slot.index) this.#report(slot, "draft/duplicate-item-id");
      if (placedQuestionIds.has(slot.questionId)) this.#report(slot, "draft/duplicate-question");
      placedQuestionIds.add(slot.questionId);
      if (this.#archivedQuestionIds.has(slot.questionId)) this.#report(slot, "draft/question-archived");
      if (!slot.question) this.#report(slot, "draft/question-version-unknown");
    }
  }

  #referencedSlot(condition: Condition): Slot | undefined {
    const index = this.#firstIndexById.get(condition.itemId);
    return index === undefined ? undefined : this.#slots[index];
  }

  #checkCondition(slot: Slot, condition: Condition): ConditionCheck {
    const referenced = this.#referencedSlot(condition);
    if (!referenced) return "predicate/unknown-item";
    if (referenced.index >= slot.index) return "predicate/forward-reference";
    const question = referenced.question;
    if (!question) return "referenced-question-unknown";
    if (question.type !== condition.type) return "predicate/type-mismatch";
    const known = new Set("options" in question ? question.options.map((option) => option.optionId) : []);
    if (referencedOptionIds(condition).some((id) => !known.has(id))) return "predicate/unknown-option";
    return undefined;
  }

  #checkReferences(slot: Slot): boolean {
    let wellFormed = true;
    for (const condition of conditionsOf(slot.visibleWhen)) {
      const check = this.#checkCondition(slot, condition);
      if (check === undefined) continue;
      wellFormed = false;
      if (check !== "referenced-question-unknown") this.#report(slot, check);
    }
    return wellFormed;
  }

  #questionOf = (itemId: string): QuestionContent | undefined => {
    const index = this.#firstIndexById.get(itemId);
    return index === undefined ? undefined : this.#slots[index]?.question;
  };

  #predicateSatisfiable(predicate: Predicate): boolean {
    if ("all" in predicate) return isTermSatisfiable(termOf(predicate.all), this.#questionOf);
    return predicate.any.some((condition) => isTermSatisfiable(termOf([condition]), this.#questionOf));
  }

  #checkSatisfiability(slot: Slot): void {
    if (slot.visibleWhen === null) return;
    if (!this.#predicateSatisfiable(slot.visibleWhen)) {
      this.#report(slot, "predicate/unsatisfiable");
      return;
    }
    const terms = this.#reachabilityTerms(slot.index);
    if (terms !== undefined && terms.length === 0) this.#report(slot, "draft/unreachable");
  }

  #reachabilityTerms(index: number): ConstraintTerm[] | undefined {
    if (this.#reachability.has(index)) return this.#reachability.get(index);
    this.#reachability.set(index, undefined);
    const terms = this.#computeReachabilityTerms(index);
    this.#reachability.set(index, terms);
    return terms;
  }

  #computeReachabilityTerms(index: number): ConstraintTerm[] | undefined {
    const slot = this.#slots[index];
    if (!slot) return undefined;
    const predicate = slot.visibleWhen;
    if (predicate === null) return [new Map()];
    const perCondition: ConstraintTerm[][] = [];
    for (const condition of conditionsOf(predicate)) {
      if (this.#checkCondition(slot, condition) !== undefined) return undefined;
      const referenced = this.#referencedSlot(condition);
      const referencedTerms = referenced && this.#reachabilityTerms(referenced.index);
      if (!referencedTerms) return undefined;
      perCondition.push(this.#satisfiable(referencedTerms.map((term) => mergeTerms(term, termOf([condition])))));
    }
    if ("any" in predicate) {
      const alternatives = perCondition.flat();
      return alternatives.length > REACHABILITY_TERM_BUDGET ? undefined : this.#satisfiable(alternatives);
    }
    let conjunction: ConstraintTerm[] = [new Map()];
    for (const alternatives of perCondition) {
      if (conjunction.length * alternatives.length > REACHABILITY_TERM_BUDGET) return undefined;
      conjunction = this.#satisfiable(
        conjunction.flatMap((term) => alternatives.map((alternative) => mergeTerms(term, alternative))),
      );
    }
    return conjunction;
  }

  #satisfiable(terms: readonly ConstraintTerm[]): ConstraintTerm[] {
    const distinct = new Map<string, ConstraintTerm>();
    for (const term of terms) {
      if (isTermSatisfiable(term, this.#questionOf)) distinct.set(termKey(term), term);
    }
    return [...distinct.values()];
  }
}

export function validateDraft(draft: DraftForValidation): DraftValidation {
  return new DraftValidator(draft).validate();
}
