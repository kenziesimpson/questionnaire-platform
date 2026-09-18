import type { Question, QuestionnaireSummary } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import { bankCountLabel, groupUsage } from "../../../src/screens/question-bank/bank-display";
import { aBankQuestion, aQuestionVersion } from "../../support/builders";

const REVIEW_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8d0";

function aQuestion(questionId: string, latestCreatedAt: string, archivedAt: string | null = null): Question {
  return {
    ...aBankQuestion(aQuestionVersion({ type: "text", questionId, createdAt: latestCreatedAt })),
    archivedAt,
  };
}

const intake: QuestionnaireSummary = {
  questionnaireId: INTAKE_QUESTIONNAIRE_ID,
  key: null,
  name: "Patient Intake",
  currentVersion: 2,
  closesAt: null,
  hasDraft: false,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-02T09:00:00.000Z",
};

describe("bankCountLabel", () => {
  it("counts questions and names how many are archived only when some are", () => {
    const active = aQuestion("01a0950e-56a0-73d6-b936-4a1e10eff9a1", "2026-09-10T09:00:00.000Z");
    const archived = aQuestion("01a0950e-56a0-73d6-b936-4a1e10eff9a2", "2026-09-10T09:00:00.000Z", "2026-09-11T09:00:00.000Z");

    expect(bankCountLabel([active])).toBe("1 question");
    expect(bankCountLabel([active, active])).toBe("2 questions");
    expect(bankCountLabel([active, archived])).toBe("2 questions, 1 archived");
  });
});

describe("groupUsage", () => {
  it("groups usage rows by questionnaire in server order, names each from the questionnaire list and lists versions oldest first", () => {
    const usage = [
      { questionnaireId: INTAKE_QUESTIONNAIRE_ID, version: 2, questionVersion: 3 },
      { questionnaireId: INTAKE_QUESTIONNAIRE_ID, version: 1, questionVersion: 1 },
      { questionnaireId: REVIEW_ID, version: 1, questionVersion: 2 },
    ];

    expect(groupUsage(usage, [intake])).toEqual([
      {
        questionnaireId: INTAKE_QUESTIONNAIRE_ID,
        name: "Patient Intake",
        placements: [
          { version: 1, questionVersion: 1 },
          { version: 2, questionVersion: 3 },
        ],
      },
      { questionnaireId: REVIEW_ID, name: null, placements: [{ version: 1, questionVersion: 2 }] },
    ]);
  });

  it("leaves every name null while the questionnaire list is not loaded", () => {
    expect(groupUsage([{ questionnaireId: INTAKE_QUESTIONNAIRE_ID, version: 1, questionVersion: 1 }], undefined)).toEqual([
      { questionnaireId: INTAKE_QUESTIONNAIRE_ID, name: null, placements: [{ version: 1, questionVersion: 1 }] },
    ]);
  });
});
