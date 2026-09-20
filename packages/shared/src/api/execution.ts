import Type from "typebox";
import { Uuid, strict } from "../primitives.js";
import { ClientAnswers } from "../domain/answer.js";
import { PublishedDefinition } from "../domain/definition.js";
import { Receipt, Session } from "../domain/session.js";
import { defineRoute } from "./route.js";

export const EXECUTION_PREFIX = "/api/run";

const SessionParams = Type.Object({ sessionId: Uuid }, strict);
const SessionWithDefinition = Type.Object({ session: Session, definition: PublishedDefinition }, strict);

export const createSession = defineRoute({
  method: "POST",
  url: "/sessions",
  schema: {
    body: Type.Object({ questionnaireId: Uuid }, strict),
    response: { 201: SessionWithDefinition },
  },
});

export const getSession = defineRoute({
  method: "GET",
  url: "/sessions/:sessionId",
  schema: { params: SessionParams, response: { 200: SessionWithDefinition } },
});

export const submitSession = defineRoute({
  method: "POST",
  url: "/sessions/:sessionId/submit",
  schema: {
    params: SessionParams,
    body: Type.Object({ answers: ClientAnswers }, strict),
    response: { 200: Type.Object({ receipt: Receipt }, strict) },
  },
});

export const executionRoutes = [createSession, getSession, submitSession] as const;
