import Type, { type Static } from "typebox";
import { IsoDateTime, PositiveInt, Uuid } from "../primitives.js";

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

export const Receipt = Type.Object(
  { sessionId: Uuid, questionnaireId: Uuid, version: PositiveInt, submittedAt: IsoDateTime },
  { additionalProperties: false },
);
export type Receipt = Static<typeof Receipt>;
