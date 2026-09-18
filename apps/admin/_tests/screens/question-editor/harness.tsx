import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import {
  QuestionEditorDialog,
  type QuestionEditorDialogProps,
} from "../../../src/screens/question-editor/question-editor-dialog";
import { withQueryClient } from "../../support/render-app";

export function renderEditor(props: Partial<QuestionEditorDialogProps> = {}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(withQueryClient(<QuestionEditorDialog open onOpenChange={onOpenChange} onSaved={onSaved} {...props} />));
  return { onSaved, onOpenChange, dialog: screen.getByRole("dialog") };
}

export const inDialog = () => within(screen.getByRole("dialog"));

export function optionIdsShown() {
  return inDialog()
    .queryAllByRole("listitem")
    .map((row) => row.getAttribute("data-option-id"));
}
