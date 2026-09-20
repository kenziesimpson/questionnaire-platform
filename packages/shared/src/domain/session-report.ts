import Type, { type Static } from "typebox";
import { IsoDateTime, NonNegativeInt, PositiveInt, Slug, Uuid, strict } from "../primitives.js";
import { ResponseRow } from "./answer.js";
import { Predicate } from "./condition.js";
import { QuestionContent } from "./question.js";
import { SessionStatus } from "./session.js";

export const RESPONSES_PAGE_SIZE = 20;

export const SessionSort = Type.Union([Type.Literal("started"), Type.Literal("submitted")]);
export type SessionSort = Static<typeof SessionSort>;

export const SortOrder = Type.Union([Type.Literal("asc"), Type.Literal("desc")]);
export type SortOrder = Static<typeof SortOrder>;

export const DEFAULT_SESSION_SORT = "started" satisfies SessionSort;
export const DEFAULT_SORT_ORDER = "desc" satisfies SortOrder;

export const SessionSummary = Type.Object(
  {
    sessionId: Uuid,
    questionnaireId: Uuid,
    version: PositiveInt,
    status: SessionStatus,
    startedAt: IsoDateTime,
    submittedAt: Type.Union([IsoDateTime, Type.Null()]),
    itemCount: NonNegativeInt,
    answeredCount: NonNegativeInt,
    hiddenCount: NonNegativeInt,
  },
  strict,
);
export type SessionSummary = Static<typeof SessionSummary>;

export const SessionSummaryPage = Type.Object(
  {
    items: Type.Array(SessionSummary),
    previousCursor: Type.Union([Type.String(), Type.Null()]),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  strict,
);
export type SessionSummaryPage = Static<typeof SessionSummaryPage>;

export const SessionDetailItem = Type.Object(
  {
    itemId: Slug,
    required: Type.Boolean(),
    visibleWhen: Type.Union([Predicate, Type.Null()]),
    question: QuestionContent,
    visible: Type.Boolean(),
    answer: Type.Union([ResponseRow, Type.Null()]),
  },
  strict,
);
export type SessionDetailItem = Static<typeof SessionDetailItem>;

export const SessionDetail = Type.Object(
  {
    sessionId: Uuid,
    questionnaireId: Uuid,
    questionnaireTitle: Type.String(),
    version: PositiveInt,
    status: SessionStatus,
    startedAt: IsoDateTime,
    submittedAt: Type.Union([IsoDateTime, Type.Null()]),
    items: Type.Array(SessionDetailItem),
  },
  strict,
);
export type SessionDetail = Static<typeof SessionDetail>;
