import { useState } from "react";
import type { ClientAnswerValue, ClientAnswers, Item } from "@qp/shared";
import { QuestionnaireItems } from "../src/questionnaire";

export function StatefulItems({
  items,
  initial = {},
  onAnswer = () => {},
}: {
  items: readonly Item[];
  initial?: ClientAnswers;
  onAnswer?: (itemId: string, answer: ClientAnswerValue | null) => void;
}) {
  const [answers, setAnswers] = useState<ClientAnswers>(initial);
  return (
    <QuestionnaireItems
      visibleItems={items}
      answers={answers}
      errors={{}}
      mode="interactive"
      onChange={(itemId, answer) => {
        onAnswer(itemId, answer);
        setAnswers((current) => ({ ...current, [itemId]: answer }));
      }}
    />
  );
}
