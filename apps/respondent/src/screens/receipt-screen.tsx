import type { PublishedDefinition, Receipt } from "@qp/shared";
import type { ReactNode } from "react";
import { Aside, Lead, ScreenHeading, ScreenLayout, StatusBadge } from "./screen-layout.tsx";

const submittedAtFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" });

function ReceiptRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-muted-foreground sm:w-32">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function ReceiptScreen({ receipt, definition }: { receipt: Receipt; definition: PublishedDefinition }) {
  return (
    <ScreenLayout>
      <StatusBadge>
        <path d="M20 6 9 17l-5-5" />
      </StatusBadge>
      <ScreenHeading title="Your answers were submitted">
        <Lead>Nothing further is needed. The copy held on this device has been cleared.</Lead>
      </ScreenHeading>
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
      <Aside>
        Keep the reference if you need to talk to the clinic about this form. Opening this link again shows this page, not a blank
        form.
      </Aside>
    </ScreenLayout>
  );
}
