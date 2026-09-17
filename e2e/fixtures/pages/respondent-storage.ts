import { ClientAnswers, IsoDateTime, Uuid } from "@qp/shared";
import Type, { type Static } from "typebox";

export const RESPONDENT_STORAGE_FORMAT_VERSION = 1;

export const RespondentStorageEnvelope = Type.Object(
  {
    formatVersion: Type.Literal(RESPONDENT_STORAGE_FORMAT_VERSION),
    sessionId: Uuid,
    questionnaireId: Uuid,
    answers: ClientAnswers,
    updatedAt: IsoDateTime,
  },
  { additionalProperties: false },
);
export type RespondentStorageEnvelope = Static<typeof RespondentStorageEnvelope>;

export function respondentStorageKey(questionnaireId: string): string {
  return `qp:respondent:${questionnaireId}`;
}
