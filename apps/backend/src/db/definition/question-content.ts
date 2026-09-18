import {
  isChoiceQuestion,
  type Option,
  type QuestionContent,
  type QuestionInput,
  type QuestionVersion,
  type ResponseType,
} from "@qp/shared";

export interface QuestionVersionColumns {
  readonly type: ResponseType;
  readonly prompt: string;
  readonly constraints: Record<string, unknown>;
  readonly options: readonly Option[];
}

export function questionInputToColumns(input: QuestionInput): QuestionVersionColumns {
  if (isChoiceQuestion(input)) {
    const { type, prompt, options, ...constraints } = input;
    return { type, prompt, constraints, options };
  }
  const { type, prompt, ...constraints } = input;
  return { type, prompt, constraints, options: [] };
}

export interface StoredOption {
  readonly optionId: string;
  readonly label: string;
  readonly freeform: boolean;
}

export interface StoredQuestionVersion {
  readonly questionId: string;
  readonly version: number;
  readonly type: ResponseType;
  readonly prompt: string;
  readonly constraints: Record<string, unknown>;
}

function toOption(option: StoredOption): Option {
  return option.freeform
    ? { optionId: option.optionId, label: option.label, freeform: true }
    : { optionId: option.optionId, label: option.label };
}

export function storedQuestionToContent(
  stored: StoredQuestionVersion,
  optionsInPosition: readonly StoredOption[],
): QuestionContent {
  const head = {
    ...stored.constraints,
    questionId: stored.questionId,
    questionVersion: stored.version,
    type: stored.type,
    prompt: stored.prompt,
  };
  return (isChoiceQuestion(stored) ? { ...head, options: optionsInPosition.map(toOption) } : head) as QuestionContent;
}

export interface StoredQuestionVersionRow extends StoredQuestionVersion {
  readonly createdAt: Date;
  readonly createdBy: string | null;
}

export function storedQuestionToVersion(
  stored: StoredQuestionVersionRow,
  optionsInPosition: readonly StoredOption[],
): QuestionVersion {
  return {
    ...storedQuestionToContent(stored, optionsInPosition),
    createdAt: stored.createdAt.toISOString(),
    createdBy: stored.createdBy,
  };
}
