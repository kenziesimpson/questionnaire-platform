import Type from "typebox";
import { Uuid, strict } from "../primitives.js";
import { ClientAnswers } from "../domain/answer.js";
import { PublishedDefinition } from "../domain/definition.js";
import { Receipt, Session } from "../domain/session.js";
import { defineRoute } from "./route.js";

/**
 * The execution API, mounted at `/api/run` — three routes, unauthenticated ([[7-application-boundary]] §5).
 * There is no route taking a `questionnaireId` that returns a definition without creating a session
 * (#18), and no checkpoint route (#25). Session reads are `no-store`.
 */
export const EXECUTION_PREFIX = "/api/run";

const SessionParams = Type.Object({ sessionId: Uuid }, strict);
const SessionWithDefinition = Type.Object({ session: Session, definition: PublishedDefinition }, strict);

/** Resolves the current published version, pins it, and returns it in the same response. */
export const createSession = defineRoute({
  method: "POST",
  url: "/sessions",
  schema: {
    body: Type.Object({ questionnaireId: Uuid }, strict),
    response: { 201: SessionWithDefinition },
  },
});

/** Resume: the session and its pinned definition — never a newer one. */
export const getSession = defineRoute({
  method: "GET",
  url: "/sessions/:sessionId",
  schema: { params: SessionParams, response: { 200: SessionWithDefinition } },
});

/**
 * Validates against the pinned definition and persists all-or-nothing. A retry with the same answers
 * replays the original receipt; different answers are `409 session/already-submitted`.
 */
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
