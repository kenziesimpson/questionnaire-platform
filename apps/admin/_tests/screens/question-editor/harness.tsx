import type { Question, QuestionVersion } from "@qp/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { vi } from "vitest";
import {
  QuestionEditorDialog,
  type QuestionEditorDialogProps,
} from "../../../src/screens/question-editor/question-editor-dialog";
import { QUESTION_ID, testQueryClient } from "../../fixtures";

class ResizeObserverJsdomLacks {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function fillJsdomLayoutGaps() {
  globalThis.ResizeObserver ??= ResizeObserverJsdomLacks;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
}

export const CREATED_AT = "2026-09-14T09:00:00.000Z";

export function aQuestionVersion(content: Partial<QuestionVersion> & Pick<QuestionVersion, "type">): QuestionVersion {
  const base = { questionId: QUESTION_ID, questionVersion: 3, createdAt: CREATED_AT, createdBy: null, prompt: "Which condition?" };
  switch (content.type) {
    case "single_choice":
    case "multiple_choice":
      return {
        ...base,
        options: [
          { optionId: "opt_diabetes", label: "Diabetes" },
          { optionId: "opt_hyperten", label: "Hypertension" },
        ],
        ...content,
      };
    case "number":
      return { ...base, numberKind: "integer", ...content };
    default:
      return { ...base, ...content };
  }
}

export function aBankQuestion(latest: QuestionVersion): Question {
  return { questionId: latest.questionId, key: null, archivedAt: null, createdAt: CREATED_AT, latest };
}

export function withQueryClient(children: ReactNode) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

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

export async function axeViolations() {
  const results = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}
