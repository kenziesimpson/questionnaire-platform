import { useId } from "react";
import { NewSessionButton, RetryButton, type NewSessionControl, type RetryControl } from "./retry-button.tsx";
import { Aside, Lead, ScreenHeading, ScreenLayout, StatusBadge } from "./screen-layout.tsx";

export const TRANSIENT_FAILURE_EXPLANATION = "The connection may have dropped, or the service may be briefly unavailable.";

export function LoadingScreen() {
  return (
    <ScreenLayout>
      <p role="status" className="text-sm text-muted-foreground">
        Loading questionnaire…
      </p>
    </ScreenLayout>
  );
}

export function ClosedScreen() {
  return (
    <ScreenLayout>
      <StatusBadge>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </StatusBadge>
      <ScreenHeading title="This questionnaire is closed" />
      <Aside>If your clinic sent you this link, ask them for a current one.</Aside>
    </ScreenLayout>
  );
}

export function NotFoundScreen() {
  return (
    <ScreenLayout>
      <StatusBadge>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </StatusBadge>
      <ScreenHeading title="Questionnaire not found">
        <Lead>This link does not lead to a questionnaire that is open for responses.</Lead>
      </ScreenHeading>
      <Aside>Check the link for typing mistakes. If your clinic sent it to you, ask them for a current one.</Aside>
    </ScreenLayout>
  );
}

export function EntryFailedScreen() {
  return (
    <ScreenLayout>
      <StatusBadge>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </StatusBadge>
      <ScreenHeading title="Something went wrong">
        <Lead>The questionnaire could not be loaded. Any answers saved on this device are kept.</Lead>
      </ScreenHeading>
      <Aside>Reload the page to try again.</Aside>
    </ScreenLayout>
  );
}

interface RetryableFailureScreenProps {
  readonly title: string;
  readonly explanation: string;
  readonly retry: RetryControl;
  readonly focusOnMount: boolean;
  readonly newSession?: { readonly control: NewSessionControl; readonly advice: string };
}

function RetryableFailureScreen({ title, explanation, retry, focusOnMount, newSession }: RetryableFailureScreenProps) {
  const explanationId = useId();
  const adviceId = useId();
  return (
    <ScreenLayout>
      <StatusBadge>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </StatusBadge>
      <div role="alert">
        <ScreenHeading title={title}>
          <Lead id={explanationId}>{explanation}</Lead>
        </ScreenHeading>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <RetryButton
            retry={retry}
            describedBy={explanationId}
            focusOnMount={focusOnMount}
            variant="default"
            blocked={newSession?.control.starting ?? false}
          />
          {newSession !== undefined && <NewSessionButton newSession={newSession.control} describedBy={adviceId} blocked={retry.retrying} />}
        </div>
        {newSession !== undefined && (
          <p id={adviceId} className="text-sm leading-relaxed text-muted-foreground">
            {newSession.advice}
          </p>
        )}
      </div>
    </ScreenLayout>
  );
}

export function LoadFailedScreen({ retry }: { retry: RetryControl }) {
  return (
    <RetryableFailureScreen
      title="The questionnaire could not be loaded"
      explanation={TRANSIENT_FAILURE_EXPLANATION}
      retry={retry}
      focusOnMount={retry.attempt > 1}
    />
  );
}

export interface ResumeFailedScreenProps {
  readonly savedAnswers: boolean;
  readonly retry: RetryControl;
  readonly newSession: NewSessionControl;
}

export function ResumeFailedScreen({ savedAnswers, retry, newSession }: ResumeFailedScreenProps) {
  const kept = savedAnswers ? " The answers you started are still saved on this device." : "";
  const advice = savedAnswers
    ? "If this keeps happening, start a new session. Your answers so far are kept and carried into it."
    : "If this keeps happening, you can start a new session instead.";
  return (
    <RetryableFailureScreen
      title="The questionnaire could not be loaded"
      explanation={TRANSIENT_FAILURE_EXPLANATION + kept}
      retry={retry}
      focusOnMount={retry.attempt > 1}
      newSession={{ control: newSession, advice }}
    />
  );
}

export function RecordedReceiptFailedScreen({ retry }: { retry: RetryControl }) {
  return (
    <RetryableFailureScreen
      title="This form was already submitted"
      explanation={`The submission on record could not be loaded. ${TRANSIENT_FAILURE_EXPLANATION}`}
      retry={retry}
      focusOnMount
    />
  );
}
