import type { PublishedDefinition, Receipt } from "@qp/shared";
import { CheckIcon } from "@qp/ui/icons";
import type { ReactNode } from "react";
import { Aside, ScreenHeading, ScreenLayout, StatusBadge } from "./screen-layout";

const submittedAtFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" });

function ReceiptRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-muted-foreground sm:w-32">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function AlreadySubmittedNote() {
  return (
    <p className="rounded-lg border px-4 py-3 text-sm leading-relaxed">
      This form had already been submitted, perhaps in another tab or window, so the answers you just sent were not recorded. The
      submission on record is below.
    </p>
  );
}

export interface ReceiptScreenProps {
  readonly receipt: Receipt;
  readonly definition: PublishedDefinition;
  readonly alreadySubmitted: boolean;
}

export function ReceiptScreen({ receipt, definition, alreadySubmitted }: ReceiptScreenProps) {
  return (
    <ScreenLayout>
      <StatusBadge icon={<CheckIcon size={22} />} />
      <ScreenHeading title={alreadySubmitted ? "This form was already submitted" : "Your answers were submitted"} />
      {alreadySubmitted && <AlreadySubmittedNote />}
      <dl className="flex flex-col gap-3 rounded-lg border bg-muted p-5 text-sm">
        <ReceiptRow term="Questionnaire">
          {definition.title} · version {receipt.version}
        </ReceiptRow>
        <ReceiptRow term="Reference">
          <span className="font-mono">{receipt.sessionId}</span>
        </ReceiptRow>
        <ReceiptRow term="Submitted">
          <time dateTime={receipt.submittedAt}>{submittedAtFormat.format(new Date(receipt.submittedAt))}</time>
        </ReceiptRow>
      </dl>
      <Aside>Keep the reference if you need to talk to the clinic about this form.</Aside>
    </ScreenLayout>
  );
}
