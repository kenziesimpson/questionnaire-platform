import type { QuestionVersion } from "@qp/shared";
import { useState } from "react";
import type { QuestionEditorDialogProps } from "./question-editor-dialog";

export type QuestionSavedHandler = (saved: QuestionVersion) => void;

type EditorTarget =
  | { mode: "closed" }
  | { mode: "create"; onSaved: QuestionSavedHandler }
  | { mode: "edit"; question: QuestionVersion; onSaved: QuestionSavedHandler };

const ignoreSaved: QuestionSavedHandler = () => undefined;

export interface QuestionEditor {
  create: (onSaved?: QuestionSavedHandler) => void;
  edit: (question: QuestionVersion, onSaved?: QuestionSavedHandler) => void;
  dialogProps: QuestionEditorDialogProps;
}

export function useQuestionEditor(): QuestionEditor {
  const [target, setTarget] = useState<EditorTarget>({ mode: "closed" });
  return {
    create: (onSaved = ignoreSaved) => setTarget({ mode: "create", onSaved }),
    edit: (question, onSaved = ignoreSaved) => setTarget({ mode: "edit", question, onSaved }),
    dialogProps: {
      open: target.mode !== "closed",
      question: target.mode === "edit" ? target.question : undefined,
      onOpenChange: (open) => {
        if (!open) setTarget({ mode: "closed" });
      },
      onSaved: (saved) => {
        if (target.mode !== "closed") target.onSaved(saved);
      },
    },
  };
}
