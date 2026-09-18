import {
  conditionsOf,
  optionIdsOf,
  referencedOptionIds,
  type Condition,
  type DraftItem,
  type DraftItemCode,
  type QuestionnaireDraft,
  type ResponseType,
} from "@qp/shared";
import { RESPONSE_TYPE_LABELS } from "../question-editor/question-form";
import { laterReferencesIn, listOfPositions, referenceOf, type Reference } from "./conditions";
import { pinnedQuestionOf } from "./draft-changes";

interface DraftItemContext {
  draft: QuestionnaireDraft;
  item: DraftItem;
  position: number;
}

interface DraftItemExplanation {
  detail: string;
  fix: string;
}

export interface DraftItemMessage {
  title: string;
  opensRules: boolean;
  explain: (context: DraftItemContext) => DraftItemExplanation;
}

const quoted = (prompt: string) => `“${prompt}”`;

type UsableReference = Extract<Reference, { kind: "earlier" | "later" }>;

function referencesIn({ draft, item }: DraftItemContext): { condition: Condition; reference: Reference }[] {
  return conditionsOf(item.visibleWhen).map((condition) => ({ condition, reference: referenceOf(draft, item.itemId, condition) }));
}

function referenceWithUnknownOption(context: DraftItemContext): UsableReference | undefined {
  return referencesIn(context).flatMap(({ condition, reference }) => {
    if (reference.kind === "unusable") return [];
    const known = new Set(optionIdsOf(reference.question));
    return referencedOptionIds(condition).some((optionId) => !known.has(optionId)) ? [reference] : [];
  })[0];
}

interface TypeMismatch {
  position: number;
  written: ResponseType;
  actual: ResponseType;
}

function firstTypeMismatch(context: DraftItemContext): TypeMismatch | undefined {
  return referencesIn(context).flatMap(({ condition, reference }) => {
    if (reference.kind !== "unusable" || reference.reason !== "type-mismatch" || reference.position === null) return [];
    const referenced = context.draft.items[reference.position - 1];
    const question = referenced === undefined ? undefined : pinnedQuestionOf(context.draft, referenced);
    return question === undefined ? [] : [{ position: reference.position, written: condition.type, actual: question.type }];
  })[0];
}

function earlierPositionsRead(context: DraftItemContext): number[] {
  return referencesIn(context).flatMap(({ reference }) => (reference.kind === "earlier" ? [reference.position] : []));
}

function distinctCount(positions: readonly number[]) {
  return new Set(positions).size;
}

export const DRAFT_ITEM_MESSAGES: { readonly [C in DraftItemCode]: DraftItemMessage } = {
  "predicate/forward-reference": {
    title: "Rule uses a later question",
    opensRules: true,
    explain: (context) => {
      const later = laterReferencesIn(context.draft, context.item);
      const others = later.filter((position) => position !== context.position);
      if (others.length === 0 && later.length > 0) {
        return {
          detail: "A condition reads this question's own answer. Rules can only use questions above.",
          fix: "Remove that condition in Rules.",
        };
      }
      if (others.length === 0) {
        return {
          detail: "A condition reads a question that comes after this one. Rules can only use questions above.",
          fix: "Move that question above this one, or change the condition in Rules.",
        };
      }
      const positions = listOfPositions(others);
      return distinctCount(others) === 1
        ? {
            detail: `A condition reads the answer to ${positions}, which now comes after this one. Rules can only use questions above.`,
            fix: `Move ${positions} above this one, or change the condition in Rules.`,
          }
        : {
            detail: `Conditions read the answers to ${positions}, which now come after this one. Rules can only use questions above.`,
            fix: `Move ${positions} above this one, or change the conditions in Rules.`,
          };
    },
  },
  "predicate/unknown-item": {
    title: "Rule uses a removed question",
    opensRules: true,
    explain: () => ({
      detail: "A condition reads a question that is no longer in this draft.",
      fix: "Remove that condition in Rules.",
    }),
  },
  "predicate/unknown-option": {
    title: "Rule uses a removed option",
    opensRules: true,
    explain: (context) => {
      const reference = referenceWithUnknownOption(context);
      return {
        detail:
          reference === undefined
            ? "A condition uses an answer option that its question no longer has."
            : `A condition on question ${reference.position}, ${quoted(reference.question.prompt)}, uses an option that its version ${reference.question.questionVersion} no longer has.`,
        fix: "Choose one of its current options in Rules, or remove the condition.",
      };
    },
  },
  "predicate/type-mismatch": {
    title: "Rule no longer fits its question",
    opensRules: true,
    explain: (context) => {
      const mismatch = firstTypeMismatch(context);
      return {
        detail:
          mismatch === undefined
            ? "A condition was written for a different kind of question than the one it reads."
            : `A condition on question ${mismatch.position} was written for a ${RESPONSE_TYPE_LABELS[mismatch.written]} question, but question ${mismatch.position} is a ${RESPONSE_TYPE_LABELS[mismatch.actual]} question.`,
        fix: "Remove that condition in Rules and add it again.",
      };
    },
  },
  "predicate/unsatisfiable": {
    title: "Rules can never be met",
    opensRules: true,
    explain: ({ item }) => ({
      detail:
        item.visibleWhen !== null && "any" in item.visibleWhen
          ? "None of its conditions can ever be true, so it would never be shown."
          : "No set of answers makes all of its conditions true, so it would never be shown.",
      fix: "Change or remove the conditions that conflict in Rules.",
    }),
  },
  "draft/unreachable": {
    title: "Can never be reached",
    opensRules: true,
    explain: (context) => {
      const read = earlierPositionsRead(context);
      if (read.length === 0) {
        return {
          detail: "Its rules can be met on their own, but not together with the rules on the questions they read. No respondent will see it.",
          fix: "Review the rules here and on the questions above that they read.",
        };
      }
      const positions = listOfPositions(read);
      return {
        detail: `Its rules can be met on their own, but not together with the rules that decide when ${positions} ${distinctCount(read) === 1 ? "is" : "are"} shown. No respondent will see it.`,
        fix: `Review the rules here and on ${positions}.`,
      };
    },
  },
  "draft/duplicate-question": {
    title: "Already asked earlier",
    opensRules: false,
    explain: ({ draft, item, position }) => {
      const first = draft.items.findIndex((candidate) => candidate.questionId === item.questionId) + 1;
      const prompt = pinnedQuestionOf(draft, item)?.prompt;
      const subject = prompt === undefined ? "This question" : quoted(prompt);
      if (first === 0 || first === position) {
        return {
          detail: `${subject} is also placed earlier in this draft. A question can appear only once in a questionnaire, so each respondent's answer is counted once.`,
          fix: "Remove one of them.",
        };
      }
      return {
        detail: `${subject} is also question ${first}. A question can appear only once in a questionnaire, so each respondent's answer is counted once.`,
        fix: `Remove one of them. If other questions' rules read this one, point them at question ${first} first.`,
      };
    },
  },
  "draft/question-archived": {
    title: "Archived in the question bank",
    opensRules: false,
    explain: ({ draft, item }) => {
      const prompt = pinnedQuestionOf(draft, item)?.prompt;
      return {
        detail: `${prompt === undefined ? "This question" : quoted(prompt)} was archived in the question bank before it could be added, so it cannot be placed in this draft.`,
        fix: "Remove it. Archived questions cannot be added to a draft.",
      };
    },
  },
  "draft/question-version-unknown": {
    title: "Question version not found",
    opensRules: false,
    explain: ({ item }) => ({
      detail: `This entry uses version ${item.questionVersion} of a question, and that version does not exist.`,
      fix: "Remove it, then add the question again from the bank.",
    }),
  },
  "draft/duplicate-item-id": {
    title: "Listed twice by mistake",
    opensRules: false,
    explain: () => ({
      detail: "This question has two entries that the editor cannot tell apart.",
      fix: "Reload the page. If it is still listed twice, remove it and add it again from the bank.",
    }),
  },
};
