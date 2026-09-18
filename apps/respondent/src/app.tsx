import type { ReactElement } from "react";
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
  SavedAnswersResumeFailedScreen,
} from "./screens/terminal-screens.tsx";
import type { RespondentSession } from "./session/respondent-session.ts";
import { viewOf, type RespondentView } from "./session/respondent-view.ts";
import { useRespondentSession } from "./session/use-respondent-session.ts";

function retryControlFor(session: RespondentSession, attempt: number, retrying: boolean): RetryControl {
  return { attempt, retrying, onRetry: () => void session.retry() };
}

function screenFor(view: RespondentView, session: RespondentSession): ReactElement {
  switch (view.kind) {
    case "loading":
      return <LoadingScreen />;
    case "notFound":
      return <NotFoundScreen />;
    case "closed":
      return <ClosedScreen />;
    case "entryFailed":
      return <EntryFailedScreen />;
    case "loadFailed":
      return <LoadFailedScreen key={view.attempt} retry={retryControlFor(session, view.attempt, view.retrying)} />;
    case "savedAnswersResumeFailed":
      return (
        <SavedAnswersResumeFailedScreen
          key={view.attempt}
          retry={retryControlFor(session, view.attempt, view.retrying)}
          newSession={{ starting: view.startingNewSession, onStart: () => void session.startNewSession() }}
        />
      );
    case "recordedReceiptFailed":
      return <RecordedReceiptFailedScreen key={view.attempt} retry={retryControlFor(session, view.attempt, view.retrying)} />;
    case "questionnaire":
      return (
        <QuestionnaireScreen
          form={view.form}
          submitting={view.submitting}
          submitFailure={view.submitFailure}
          rejection={view.rejection}
          onAnswerChange={session.changeAnswers}
          onPersist={session.persistAnswers}
          onSubmit={session.submit}
        />
      );
    case "receipt":
      return <ReceiptScreen receipt={view.receipt} definition={view.definition} alreadySubmitted={view.alreadySubmitted} />;
  }
}

function Respondent({ questionnaireId }: { questionnaireId: string }) {
  const { state, session } = useRespondentSession(questionnaireId);
  return screenFor(viewOf(state), session);
}

export function App({ pathname = window.location.pathname }: { pathname?: string }) {
  const questionnaireId = questionnaireIdFromPath(pathname);
  return questionnaireId === undefined ? <NotFoundScreen /> : <Respondent questionnaireId={questionnaireId} />;
}
