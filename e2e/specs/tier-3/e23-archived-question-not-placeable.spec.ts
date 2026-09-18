import { definitionApi } from "@qp/shared";
import { draftItem, expect, problemOf, problemReplyOfExchange, test, uniqueName } from "../../fixtures/index";
import { promptOf, textQuestionInput } from "./support/question-input";

const PUBLISHED_ITEM_ID = "itm_archived_later";
const DIRECT_ADD_ITEM_ID = "itm_direct_add";

test.describe("E23 an archived question cannot be placed", () => {
  test("an archived question is missing from the picker, a direct add is refused, and its published placement still renders", async ({
    api,
    admin,
    page,
    respondent,
  }) => {
    const archived = await api.createQuestion(textQuestionInput("E23 archived after placing"));
    const active = await api.createQuestion(textQuestionInput("E23 still active"));
    const archivedPrompt = promptOf(archived);
    const published = await api.createPublishedQuestionnaire(
      { name: uniqueName("E23 already placed"), title: "E23 already placed" },
      [{ itemId: PUBLISHED_ITEM_ID, question: archived, required: false }],
    );
    const archivedQuestion = await api.archiveQuestion(archived.questionId);
    expect(archivedQuestion.archivedAt).not.toBeNull();

    const { questionnaireId: draftId } = await api.createQuestionnaire({ name: uniqueName("E23 new placement"), title: "E23 new placement" });

    await admin.openDraftEditor(draftId);
    await admin.addQuestionButton().click();
    const picker = page.getByRole("dialog", { name: "Add a question", exact: true });
    const bank = picker.getByRole("list", { name: "Active questions in the bank", exact: true });
    await expect(bank.getByRole("button", { name: `Add “${promptOf(active)}”, version 1`, exact: true })).toBeVisible();
    await expect(bank.getByText(archivedPrompt, { exact: true })).toHaveCount(0);
    await expect(picker.getByRole("button", { name: `Add “${archivedPrompt}”, version 1`, exact: true })).toHaveCount(0);

    const { etag } = await api.getDraft(draftId);
    const directAdd = await api.send(definitionApi.replaceDraft, {
      params: { id: draftId },
      ifMatch: etag,
      body: { title: "E23 new placement", items: [draftItem({ itemId: DIRECT_ADD_ITEM_ID, question: archived })] },
    });
    const refusal = problemReplyOfExchange(directAdd);
    expect(refusal.status).toBe(422);
    expect(refusal.slug).toBe("questionnaire/draft-invalid");
    expect(problemOf(refusal, "questionnaire/draft-invalid").items).toEqual([{ itemId: DIRECT_ADD_ITEM_ID, code: "draft/question-archived" }]);

    const unchanged = await api.getDraft(draftId);
    expect(unchanged.etag).toBe(etag);
    expect(unchanged.draft.items).toEqual([]);

    const snapshot = await api.getVersion(published.questionnaire.questionnaireId, 1);
    expect(snapshot.items.map((item) => item.question.questionId)).toEqual([archived.questionId]);
    await respondent.openForm(published.questionnaire.questionnaireId);
    await expect(respondent.question(archivedPrompt)).toBeVisible();
  });
});
