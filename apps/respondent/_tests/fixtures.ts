import { type Receipt, type Session } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID, intakeDefinition } from "@qp/shared/demo";

export const SESSION_ID = "4f9c2a7e-1b3d-4e8f-a6c5-9d0b1e2f3a4b";
export const OTHER_QUESTIONNAIRE_ID = "01a0950e-9999-7aaa-8bbb-cccccccccccc";
export const ANSWER_SENTINEL = "SENTINEL-answer-value-7f3e";

export const inProgressSession: Session = {
  sessionId: SESSION_ID,
  questionnaireId: INTAKE_QUESTIONNAIRE_ID,
  version: 1,
  status: "in_progress",
  startedAt: "2026-09-14T09:00:00.000Z",
  submittedAt: null,
};

export const submittedSession: Session = {
  ...inProgressSession,
  status: "submitted",
  submittedAt: "2026-09-14T09:12:00.000Z",
};

export const receipt: Receipt = {
  sessionId: SESSION_ID,
  questionnaireId: INTAKE_QUESTIONNAIRE_ID,
  version: 1,
  submittedAt: "2026-09-14T09:12:00.000Z",
};

export const intakeV1 = intakeDefinition(1);
