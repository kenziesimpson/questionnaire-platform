import type { ClientAnswerValue, ClientAnswerValueOf, ClientAnswers, Item, QuestionContent, ResponseType } from "@qp/shared";

export type RendererMode = "interactive" | "readonly";

export type ItemErrors = Readonly<Partial<Record<string, string>>>;

export type AnswerChangeHandler = (itemId: string, answer: ClientAnswerValue | null) => void;

export type QuestionOf<T extends ResponseType> = Extract<QuestionContent, { type: T }>;

export interface RendererProps {
  answers: ClientAnswers;
  errors: ItemErrors;
  onChange: AnswerChangeHandler;
  mode: RendererMode;
}

export interface ControlProps<T extends ResponseType> {
  item: Item & { question: QuestionOf<T> };
  answer: ClientAnswerValueOf<T> | undefined;
  error: string | undefined;
  mode: RendererMode;
  onChange: AnswerChangeHandler;
}
