import { questionnaireIdFromPath } from "./entry/questionnaire-path.ts";
import { QuestionnaireScreen } from "./screens/questionnaire-screen.tsx";
import { ReceiptScreen } from "./screens/receipt-screen.tsx";
import type { RetryControl } from "./screens/retry-button.tsx";
import {
  ClosedScreen,
  EntryFailedScreen,
  LoadFailedScreen,
  LoadingScreen,
  NotFoundScreen,
  RecordedReceiptFailedScreen,
} from "./screens/terminal-screens.tsx";
import type { RespondentSession } from "./session/respondent-session.ts";
import { hasAnyAnswer, isRetryable, type FailedState, type Failure, type FormContext, type RespondentState } from "./session/respondent-state.ts";
import { useRespondentSession } from "./session/use-respondent-session.ts";
import type { StoredPartials } from "./storage/partials.ts";

interface QuestionnaireView {
  readonly form: FormContext;
  readonly submitting: boolean;
  readonly submitFailure: Failure | null;
}

function retryControl(session: RespondentSession, failure: Failure, retrying: boolean): RetryControl {
  return { attempt: failure.attempt, retrying, onRetry: () => void session.retry() };
}

function Questionnaire({ state, session, view }: { state: RespondentState; session: RespondentSession; view: QuestionnaireView }) {
  return (
    <QuestionnaireScreen
      form={view.form}
      submitting={view.submitting}
      submitFailure={view.submitFailure}
      rejection={state.name === "ready" ? state.rejection : null}
      onAnswerChange={session.changeAnswers}
      onSubmit={session.submit}
    />
  );
}

function loadFailedScreen(session: RespondentSession, failure: Failure, retrying: boolean, stored: StoredPartials | null) {
  if (!isRetryable(failure.reason)) return <EntryFailedScreen />;
  const savedAnswers = stored !== null && hasAnyAnswer(stored.answers);
  return <LoadFailedScreen key={failure.attempt} savedAnswers={savedAnswers} retry={retryControl(session, failure, retrying)} />;
}

function recordedReceiptFailedScreen(session: RespondentSession, failure: Failure, retrying: boolean) {
  if (!isRetryable(failure.reason)) return <EntryFailedScreen />;
  return <RecordedReceiptFailedScreen key={failure.attempt} retry={retryControl(session, failure, retrying)} />;
}

function failedScreen(state: FailedState, session: RespondentSession) {
  switch (state.step) {
    case "starting":
      return loadFailedScreen(session, state.failure, false, null);
    case "resuming":
      return loadFailedScreen(session, state.failure, false, state.stored);
    case "submitting":
      return <Questionnaire state={state} session={session} view={{ form: state, submitting: false, submitFailure: state.failure }} />;
    case "fetchingRecordedReceipt":
      return recordedReceiptFailedScreen(session, state.failure, false);
  }
}

function screenFor(state: RespondentState, session: RespondentSession) {
  switch (state.name) {
    case "entering":
      return <LoadingScreen />;
    case "starting":
      return state.previousFailure === null ? <LoadingScreen /> : loadFailedScreen(session, state.previousFailure, true, null);
    case "resuming":
      return state.previousFailure === null ? <LoadingScreen /> : loadFailedScreen(session, state.previousFailure, true, state.stored);
    case "ready":
      return <Questionnaire state={state} session={session} view={{ form: state, submitting: false, submitFailure: null }} />;
    case "submitting":
      return <Questionnaire state={state} session={session} view={{ form: state, submitting: true, submitFailure: state.previousFailure }} />;
    case "fetchingRecordedReceipt":
      return state.previousFailure === null ? (
        <Questionnaire state={state} session={session} view={{ form: state, submitting: true, submitFailure: null }} />
      ) : (
        recordedReceiptFailedScreen(session, state.previousFailure, true)
      );
    case "failed":
      return failedScreen(state, session);
    case "done":
      return <ReceiptScreen receipt={state.receipt} definition={state.definition} alreadySubmitted={state.alreadySubmitted} />;
    case "closed":
      return <ClosedScreen />;
    case "notFound":
      return <NotFoundScreen />;
  }
}

function Respondent({ questionnaireId }: { questionnaireId: string }) {
  const { state, session } = useRespondentSession(questionnaireId);
  return screenFor(state, session);
}

export function App({ pathname = window.location.pathname }: { pathname?: string }) {
  const questionnaireId = questionnaireIdFromPath(pathname);
  return questionnaireId === undefined ? <NotFoundScreen /> : <Respondent questionnaireId={questionnaireId} />;
}
