import type {
  ClientAnswerValue,
  ClientAnswerValueOf,
  ClientAnswers,
  Item,
  QuestionOf,
  ResponseType,
  SubmissionItemCode,
} from "@qp/shared";

export type RendererMode = "interactive" | "readonly";

export type ItemErrors = Readonly<Partial<Record<string, readonly SubmissionItemCode[]>>>;

export type AnswerChangeHandler = (itemId: string, answer: ClientAnswerValue | null) => void;

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
