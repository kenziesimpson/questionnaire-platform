import { evaluateVisibility, type ClientAnswers, type PublishedDefinition } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { QuestionnaireForm, type AnswerChangeHandler, type ItemErrors } from "@qp/ui/questionnaire";
import { useId, useMemo, useState } from "react";
import { HiddenByRules } from "./hidden-by-rules";
import { SampleAnswersPanel, numberedItems } from "./sample-answers-panel";

const NO_ERRORS: ItemErrors = {};

const ignoreRendererChange: AnswerChangeHandler = () => undefined;

export function PreviewBody({ definition }: { definition: PublishedDefinition }) {
  const [answers, setAnswers] = useState<ClientAnswers>({});
  const titleId = useId();
  const submitNoteId = useId();

  const { shownItems, hiddenItems } = useMemo(() => {
    const shown = evaluateVisibility(definition, answers);
    const numbered = numberedItems(definition.items);
    return {
      shownItems: numbered.filter(({ item }) => shown.has(item.itemId)),
      hiddenItems: numbered.filter(({ item }) => !shown.has(item.itemId)),
    };
  }, [definition, answers]);

  const setSampleAnswer: AnswerChangeHandler = (itemId, answer) =>
    setAnswers((current) => ({ ...current, [itemId]: answer }));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Version {definition.version} exactly as a respondent receives it. No session is created and nothing is
          recorded.
        </p>
        <section
          aria-labelledby={titleId}
          className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6 text-card-foreground"
        >
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {definition.title}
          </h2>
          <QuestionnaireForm
            definition={definition}
            answers={answers}
            errors={NO_ERRORS}
            onChange={ignoreRendererChange}
            mode="readonly"
          />
          <div className="flex items-center gap-3 border-t border-border pt-4">
            <Button disabled aria-describedby={submitNoteId}>
              Submit answers
            </Button>
            <span id={submitNoteId} className="text-xs text-muted-foreground">
              Disabled in preview.
            </span>
          </div>
        </section>
      </div>
      <div className="flex flex-col gap-4">
        <SampleAnswersPanel
          shownItems={shownItems}
          answers={answers}
          onChange={setSampleAnswer}
          onReset={() => setAnswers({})}
        />
        <HiddenByRules hiddenItems={hiddenItems} />
      </div>
    </div>
  );
}
