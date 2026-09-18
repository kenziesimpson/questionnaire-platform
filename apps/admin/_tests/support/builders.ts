import { formatDraftEtag, type DraftItem, type Question, type QuestionVersion, type QuestionnaireDraft } from "@qp/shared";
import { INTAKE_QUESTIONNAIRE_ID, intakeDefinition } from "@qp/shared/demo";

export const QUESTIONNAIRE_ID = INTAKE_QUESTIONNAIRE_ID;
export const VERSION_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c1";
export const QUESTION_ID = "01a0950e-56a0-73d6-b936-4a1e10eff8c2";

export const CREATED_AT = "2026-09-14T09:00:00.000Z";

export const uuid = (n: number) => `01a0950e-56a0-73d6-b936-4a1e10eff${String(n).padStart(3, "0")}`;

export const etagAt = (revision: number) => formatDraftEtag(VERSION_ID, revision);

export function anItem(itemId: string): DraftItem {
  return { itemId, required: true, visibleWhen: null, questionId: QUESTION_ID, questionVersion: 1 };
}

export function aDraft(itemIds: string[] = ["itm_01", "itm_02"]): QuestionnaireDraft {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    versionId: VERSION_ID,
    title: intakeDefinition(1).title,
    updatedAt: "2026-09-14T09:00:00.000Z",
    items: itemIds.map(anItem),
    questions: [],
  };
}

export function aQuestionVersion(content: Partial<QuestionVersion> & Pick<QuestionVersion, "type">): QuestionVersion {
  const base = { questionId: QUESTION_ID, questionVersion: 3, createdAt: CREATED_AT, createdBy: null, prompt: "Which condition?" };
  switch (content.type) {
    case "single_choice":
    case "multiple_choice":
      return {
        ...base,
        options: [
          { optionId: "opt_diabetes", label: "Diabetes" },
          { optionId: "opt_hyperten", label: "Hypertension" },
        ],
        ...content,
      };
    case "number":
      return { ...base, numberKind: "integer", ...content };
    default:
      return { ...base, ...content };
  }
}

export function aBankQuestion(latest: QuestionVersion): Question {
  return { questionId: latest.questionId, key: null, archivedAt: null, createdAt: CREATED_AT, latest };
}

export const smoke = aQuestionVersion({
  type: "single_choice",
  questionId: uuid(101),
  questionVersion: 1,
  prompt: "Do you smoke?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
});
