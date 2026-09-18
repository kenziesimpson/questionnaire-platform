import { definitionApi } from "@qp/shared";
import { expect, test, uniqueName, waitForDefinitionResponse } from "../../fixtures/index";
import { promptOf, textQuestionInput } from "./support/question-input";

const SHARED_ITEM_ID = "itm_shared";

test.describe("E22 editing a question from the draft editor re-pins that item", () => {
  test("the edited item pins the new question version, the other questionnaire keeps the old pin, and the bank shows both versions in use", async ({
    api,
    admin,
    db,
    page,
  }) => {
    const shared = await api.createQuestion(textQuestionInput("E22 shared question"));
    const originalPrompt = promptOf(shared);
    const placement = [{ itemId: SHARED_ITEM_ID, question: shared }];
    const editedIn = await api.createPublishedQuestionnaire({ name: uniqueName("E22 edited in"), title: "E22 edited in" }, placement);
    const untouched = await api.createPublishedQuestionnaire({ name: uniqueName("E22 untouched"), title: "E22 untouched" }, placement);
    const editedInId = editedIn.questionnaire.questionnaireId;
    const untouchedId = untouched.questionnaire.questionnaireId;
    await api.openDraft(editedInId);
    await api.openDraft(untouchedId);

    await admin.openDraftEditor(editedInId);
    const originalRow = admin.draftItemRow(1, originalPrompt);
    await expect(originalRow.getByText("Text · pinned v1 · Always shown")).toBeVisible();
    const editButton = originalRow.getByRole("button", { name: "Edit question 1", exact: true });
    await expect(editButton).toBeEnabled();
    await editButton.click();

    const editor = page.getByRole("dialog", { name: "Edit question", exact: true });
    await expect(editor.getByText("version 1", { exact: true })).toBeVisible();
    const editedPrompt = uniqueName("E22 shared question, reworded");
    await editor.getByLabel("Prompt", { exact: true }).fill(editedPrompt);

    const versionSaved = waitForDefinitionResponse(page, definitionApi.createQuestionVersion, { questionId: shared.questionId });
    const draftSaved = waitForDefinitionResponse(page, definitionApi.replaceDraft, { id: editedInId });
    await editor.getByRole("button", { name: "Save as version 2", exact: true }).click();
    expect((await versionSaved).status()).toBe(201);
    expect((await draftSaved).status()).toBe(200);
    await expect(editor).toBeHidden();

    const repinnedRow = admin.draftItemRow(1, editedPrompt);
    await expect(repinnedRow.getByText("Text · pinned v2 · Always shown")).toBeVisible();
    await expect(repinnedRow.getByText("Newer version available")).toHaveCount(0);

    const editedInDraft = await api.getDraft(editedInId);
    expect(editedInDraft.draft.items).toEqual([expect.objectContaining({ itemId: SHARED_ITEM_ID, questionId: shared.questionId, questionVersion: 2 })]);

    const untouchedDraft = await api.getDraft(untouchedId);
    expect(untouchedDraft.draft.items).toEqual([expect.objectContaining({ itemId: SHARED_ITEM_ID, questionId: shared.questionId, questionVersion: 1 })]);
    const untouchedPublished = await api.getVersion(untouchedId, 1);
    expect(untouchedPublished.items.map((item) => [item.question.questionVersion, item.question.prompt])).toEqual([[1, originalPrompt]]);
    const editedInPublished = await api.getVersion(editedInId, 1);
    expect(editedInPublished.items.map((item) => [item.question.questionVersion, item.question.prompt])).toEqual([[1, originalPrompt]]);

    expect(await db.questionVersionCount(shared.questionId)).toBe(2);
    expect((await api.listQuestionVersions(shared.questionId)).map((version) => version.questionVersion)).toEqual([2, 1]);

    await admin.openDraftEditor(untouchedId);
    const untouchedRow = admin.draftItemRow(1, originalPrompt);
    await expect(untouchedRow.getByText("Text · pinned v1 · Always shown")).toBeVisible();
    await expect(untouchedRow.getByText("Newer version available")).toBeVisible();
    await expect(untouchedRow.getByRole("button", { name: "Re-pin question 1 to version 2", exact: true })).toBeVisible();

    await api.publishCurrentDraft(editedInId);

    await admin.openQuestionBank();
    const bankRow = page.getByRole("row").filter({ has: page.getByText(editedPrompt, { exact: true }) });
    await expect(bankRow.getByRole("cell", { name: "v2", exact: true })).toBeVisible();
    const usage = bankRow.getByRole("list", { name: `Published versions using ${editedPrompt}`, exact: true });
    const editedInName = editedIn.questionnaire.name;
    const untouchedName = untouched.questionnaire.name;
    await expect(usage.getByRole("link", { name: `Preview ${editedInName} v1, which uses question v1`, exact: true })).toBeVisible();
    await expect(usage.getByRole("link", { name: `Preview ${editedInName} v2, which uses question v2`, exact: true })).toBeVisible();
    await expect(usage.getByRole("link", { name: `Preview ${untouchedName} v1, which uses question v1`, exact: true })).toBeVisible();
    await expect(usage.getByRole("link")).toHaveCount(3);
  });
});
