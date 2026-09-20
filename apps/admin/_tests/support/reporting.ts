import type { SessionDetail, SessionDetailItem, SessionSummary, SessionSummaryPage } from "@qp/shared";
import { INTAKE_ITEM_IDS, INTAKE_OPTION_IDS, INTAKE_QUESTION_IDS, intakeDefinition, type IntakeVersion } from "@qp/shared/demo";
import { QUESTIONNAIRE_ID } from "./builders";

export function sessionIdOf(n: number): string {
  return `${n.toString(16).padStart(8, "0")}-5e55-7000-8000-000000000000`;
}

export function shortIdOf(n: number): string {
  return sessionIdOf(n).slice(0, 8);
}

const STARTED = Date.parse("2026-09-10T09:00:00.000Z");

export function startedAtOf(n: number): string {
  return new Date(STARTED + n * 60_000).toISOString();
}

export function aSessionSummary(n: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: sessionIdOf(n),
    questionnaireId: QUESTIONNAIRE_ID,
    version: 1,
    status: "submitted",
    startedAt: startedAtOf(n),
    submittedAt: startedAtOf(n + 1),
    itemCount: 4,
    answeredCount: 2,
    hiddenCount: 2,
    ...overrides,
  };
}

export function anInProgressSummary(n: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return aSessionSummary(n, { status: "in_progress", submittedAt: null, answeredCount: 0, hiddenCount: 0, ...overrides });
}

export function aSessionPage(items: SessionSummary[], cursors: { previous?: string; next?: string } = {}): SessionSummaryPage {
  return { items, previousCursor: cursors.previous ?? null, nextCursor: cursors.next ?? null };
}

type ItemState = Pick<SessionDetailItem, "visible" | "answer">;

function head(itemId: string, questionId: string, questionVersion = 1) {
  return { itemId, questionId, questionVersion };
}

export const NO_CONDITION_STATES: Readonly<Record<string, ItemState>> = {
  [INTAKE_ITEM_IDS.hasCondition]: {
    visible: true,
    answer: {
      ...head(INTAKE_ITEM_IDS.hasCondition, INTAKE_QUESTION_IDS.hasCondition),
      type: "single_choice",
      optionIds: [INTAKE_OPTION_IDS.no],
    },
  },
  [INTAKE_ITEM_IDS.whichCondition]: { visible: false, answer: null },
  [INTAKE_ITEM_IDS.diagnosedOn]: { visible: false, answer: null },
  [INTAKE_ITEM_IDS.pharmacy]: {
    visible: true,
    answer: { ...head(INTAKE_ITEM_IDS.pharmacy, INTAKE_QUESTION_IDS.pharmacy), type: "text", text: "Corner Pharmacy" },
  },
};

export const YES_CONDITION_STATES: Readonly<Record<string, ItemState>> = {
  [INTAKE_ITEM_IDS.hasCondition]: {
    visible: true,
    answer: {
      ...head(INTAKE_ITEM_IDS.hasCondition, INTAKE_QUESTION_IDS.hasCondition),
      type: "single_choice",
      optionIds: [INTAKE_OPTION_IDS.yes],
    },
  },
  [INTAKE_ITEM_IDS.whichCondition]: {
    visible: true,
    answer: {
      ...head(INTAKE_ITEM_IDS.whichCondition, INTAKE_QUESTION_IDS.whichCondition, 3),
      type: "single_choice",
      optionIds: [INTAKE_OPTION_IDS.hypertension],
    },
  },
  [INTAKE_ITEM_IDS.diagnosedOn]: {
    visible: true,
    answer: { ...head(INTAKE_ITEM_IDS.diagnosedOn, INTAKE_QUESTION_IDS.diagnosedOn), type: "date", date: "2020-02-29" },
  },
  [INTAKE_ITEM_IDS.pharmacy]: { visible: true, answer: null },
};

export function aSessionDetail(
  n: number,
  {
    version = 1,
    status = "submitted",
    states = NO_CONDITION_STATES,
    ...overrides
  }: Partial<SessionDetail> & { version?: IntakeVersion; states?: Readonly<Record<string, ItemState>> } = {},
): SessionDetail {
  const definition = intakeDefinition(version);
  const inProgress = status === "in_progress";
  return {
    sessionId: sessionIdOf(n),
    questionnaireId: QUESTIONNAIRE_ID,
    questionnaireTitle: definition.title,
    version,
    status,
    startedAt: startedAtOf(n),
    submittedAt: inProgress ? null : startedAtOf(n + 1),
    items: definition.items.map((item) => ({
      ...item,
      ...(inProgress ? { visible: true, answer: null } : (states[item.itemId] ?? { visible: true, answer: null })),
    })),
    ...overrides,
  };
}
