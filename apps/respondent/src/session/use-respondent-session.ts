import { useEffect, useState, useSyncExternalStore } from "react";
import { watchAbandonment } from "../telemetry/abandonment";
import { createRespondentSession, type RespondentSession } from "./respondent-session";
import type { RespondentState } from "./respondent-state";

export function useRespondentSession(questionnaireId: string): { state: RespondentState; session: RespondentSession } {
  const [session] = useState(() => createRespondentSession(questionnaireId));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => {
    void session.enter();
  }, [session]);
  useEffect(() => watchAbandonment(session.progress), [session]);
  return { state, session };
}
