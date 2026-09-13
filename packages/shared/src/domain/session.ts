import Type, { type Static } from "typebox";
import { IsoDateTime, PositiveInt, Uuid } from "../primitives.js";

/** `in_progress → submitted` and nothing else; abandonment is the absence of a submit. */
export const SessionStatus = Type.Union([Type.Literal("in_progress"), Type.Literal("submitted")]);
export type SessionStatus = Static<typeof SessionStatus>;

export const Session = Type.Object(
  {
    sessionId: Uuid,
    questionnaireId: Uuid,
    version: PositiveInt,
    status: SessionStatus,
    startedAt: IsoDateTime,
    submittedAt: Type.Union([IsoDateTime, Type.Null()]),
  },
  { additionalProperties: false },
);
export type Session = Static<typeof Session>;

/**
 * The session row and nothing derived ([[7-application-boundary]] §5.4), so an idempotent replay
 * needs nothing stored beyond the session itself.
 */
export const Receipt = Type.Object(
  { sessionId: Uuid, questionnaireId: Uuid, version: PositiveInt, submittedAt: IsoDateTime },
  { additionalProperties: false },
);
export type Receipt = Static<typeof Receipt>;
