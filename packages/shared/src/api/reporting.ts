import Type from "typebox";
import { PositiveInt, Uuid, strict } from "../primitives.js";
import { SessionDetail, SessionSummaryPage } from "../domain/session-report.js";
import { SessionStatus } from "../domain/session.js";
import { defineRoute } from "./route.js";

export const REPORTING_PREFIX = "/api/reporting";

const QuestionnaireParams = Type.Object({ id: Uuid }, strict);
const SessionParams = Type.Object({ id: Uuid, sessionId: Uuid }, strict);

const SessionListQuery = Type.Object(
  {
    version: Type.Optional(PositiveInt),
    status: Type.Optional(SessionStatus),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  strict,
);

export const listSessions = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/responses",
  schema: { params: QuestionnaireParams, querystring: SessionListQuery, response: { 200: SessionSummaryPage } },
});

export const getSessionDetail = defineRoute({
  method: "GET",
  url: "/questionnaires/:id/responses/:sessionId",
  schema: { params: SessionParams, response: { 200: SessionDetail } },
});

export const reportingRoutes = [listSessions, getSessionDetail] as const;
