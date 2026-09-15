import { questionnaireIdFromPath } from "./entry/questionnaire-path.ts";
import { QuestionnaireScreen } from "./screens/questionnaire-screen.tsx";
import { ReceiptScreen } from "./screens/receipt-screen.tsx";
import { ClosedScreen, EntryFailedScreen, LoadingScreen, NotFoundScreen } from "./screens/terminal-screens.tsx";
import { formContextOf } from "./session/respondent-state.ts";
import { useRespondentSession } from "./session/use-respondent-session.ts";

function Respondent({ questionnaireId }: { questionnaireId: string }) {
  const { state, session } = useRespondentSession(questionnaireId);
  const form = formContextOf(state);
  if (form !== null) {
    return (
      <QuestionnaireScreen
        form={form}
        submitting={state.name === "submitting" || state.name === "fetchingRecordedReceipt"}
        submitFailed={state.name === "failed"}
        rejection={state.name === "ready" ? state.rejection : null}
        onAnswerChange={session.changeAnswers}
        onSubmit={session.submit}
      />
    );
  }
  switch (state.name) {
    case "done":
      return <ReceiptScreen receipt={state.receipt} definition={state.definition} alreadySubmitted={state.alreadySubmitted} />;
    case "closed":
      return <ClosedScreen />;
    case "notFound":
      return <NotFoundScreen />;
    case "failed":
      return <EntryFailedScreen />;
    default:
      return <LoadingScreen />;
  }
}

export function App({ pathname = window.location.pathname }: { pathname?: string }) {
  const questionnaireId = questionnaireIdFromPath(pathname);
  return questionnaireId === undefined ? <NotFoundScreen /> : <Respondent questionnaireId={questionnaireId} />;
}
