import { useEffect, useState, useSyncExternalStore } from "react";
import { createRespondentSession, type RespondentSession } from "./respondent-session.ts";
import type { RespondentState } from "./respondent-state.ts";

export function useRespondentSession(questionnaireId: string): { state: RespondentState; session: RespondentSession } {
  const [session] = useState(() => createRespondentSession(questionnaireId));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => {
    void session.enter();
  }, [session]);
  return { state, session };
}
