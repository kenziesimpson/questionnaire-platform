import { useMemo } from "react";
import { visibleItems, type PublishedDefinition } from "@qp/shared";
import { QuestionnaireItems } from "./questionnaire-items";
import type { RendererProps } from "./types";

export interface QuestionnaireFormProps extends RendererProps {
  definition: PublishedDefinition;
}

export function QuestionnaireForm({ definition, answers, ...renderer }: QuestionnaireFormProps) {
  const shown = useMemo(() => visibleItems(definition, answers), [definition, answers]);
  return <QuestionnaireItems visibleItems={shown} answers={answers} {...renderer} />;
}
