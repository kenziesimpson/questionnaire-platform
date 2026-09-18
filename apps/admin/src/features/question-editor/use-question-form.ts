import type { QuestionVersion } from "@qp/shared";
import { useState, type Dispatch, type SetStateAction } from "react";
import { blankForm, formFromQuestion, type QuestionForm } from "./form-state";

export function useQuestionForm(question: QuestionVersion | undefined): [QuestionForm, Dispatch<SetStateAction<QuestionForm>>] {
  return useState<QuestionForm>(() => (question === undefined ? blankForm() : formFromQuestion(question)));
}
