import type { DefinitionApi, ExecutionApi, PublishedQuestionnaire, SessionTimes, StackDatabase } from "../../../fixtures/index";
import { uniqueName } from "../../../fixtures/index";
import { textQuestionInput } from "./question-input";

const SESSION_EPOCH = Date.parse("2026-05-01T10:00:00.000Z");

export function minutesAfterEpoch(minutes: number): Date {
  return new Date(SESSION_EPOCH + minutes * 60_000);
}

export interface TimedSession {
  readonly sessionId: string;
  readonly shortId: string;
  readonly times: SessionTimes;
}

export async function anOptionalItemQuestionnaire(api: DefinitionApi, name: string): Promise<PublishedQuestionnaire> {
  const question = await api.createQuestion(textQuestionInput(`${name} note`));
  return api.createPublishedQuestionnaire({ name: uniqueName(name), title: `${name} fixture` }, [
    { itemId: "itm_note", question, required: false },
  ]);
}

export async function timedSessions(
  execution: ExecutionApi,
  db: StackDatabase,
  questionnaireId: string,
  times: readonly SessionTimes[],
): Promise<TimedSession[]> {
  return Promise.all(
    times.map(async (time) => {
      const { session } = await execution.createSession(questionnaireId);
      if (time.submittedAt !== null) {
        await execution.submit(session.sessionId, {});
      }
      await db.setSessionTimes(session.sessionId, time);
      return { sessionId: session.sessionId, shortId: session.sessionId.slice(0, 8), times: time };
    }),
  );
}

export function shortIdsInOrder(sessions: readonly TimedSession[], order: readonly number[]): string[] {
  return order.map((index) => sessions[index]?.shortId ?? "");
}
