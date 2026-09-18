import { visibleItems, type ClientAnswers, type PublishedDefinition } from "@qp/shared";
import { itemErrorMessage, type ItemErrors } from "@qp/ui/questionnaire";
import { useId, type Ref } from "react";

export interface ErrorSummaryEntry {
  readonly itemId: string;
  readonly prompt: string;
  readonly message: string;
}

export function errorSummaryEntries(definition: PublishedDefinition, answers: ClientAnswers, errors: ItemErrors): ErrorSummaryEntry[] {
  return visibleItems(definition, answers).flatMap(({ itemId, question }) => {
    const message = itemErrorMessage(errors[itemId], question);
    return message === undefined ? [] : [{ itemId, prompt: question.prompt, message }];
  });
}

export function errorSummaryTitle(entryCount: number): string {
  if (entryCount === 0) return "Your answers could not be submitted";
  return entryCount === 1 ? "1 answer needs attention" : `${entryCount} answers need attention`;
}

export const UNPLACED_ERRORS_MESSAGE = "Some answers could not be accepted. Check your answers and submit again.";

export interface ErrorSummaryProps {
  readonly ref: Ref<HTMLElement>;
  readonly entries: readonly ErrorSummaryEntry[];
  readonly unplacedErrors: boolean;
  readonly onJump: (itemId: string) => void;
}

export function ErrorSummary({ ref, entries, unplacedErrors, onJump }: ErrorSummaryProps) {
  const titleId = useId();
  const unplacedId = useId();
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={unplacedErrors ? unplacedId : undefined}
      className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-destructive/25"
    >
      <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-destructive">
        <svg
          aria-hidden="true"
          className="shrink-0"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v5" />
          <path d="M12 16h.01" />
        </svg>
        {errorSummaryTitle(entries.length)}
      </h2>
      {entries.length > 0 && (
        <ul className="flex list-disc flex-col gap-1.5 pl-7 leading-relaxed">
          {entries.map(({ itemId, prompt, message }) => (
            <li key={itemId}>
              <button
                type="button"
                className="rounded-sm text-left font-medium underline underline-offset-4 outline-none hover:text-foreground/80 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onJump(itemId)}
              >
                {prompt}
              </button>
              {" — "}
              {message}
            </li>
          ))}
        </ul>
      )}
      {unplacedErrors && (
        <p id={unplacedId} className="leading-relaxed">
          {UNPLACED_ERRORS_MESSAGE}
        </p>
      )}
    </section>
  );
}
