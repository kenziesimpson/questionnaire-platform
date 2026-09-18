import { definitionApi, parseDraftEtag } from "@qp/shared";
import { expect, test, uniqueName, waitForDefinitionResponse } from "../../fixtures/index.ts";
import { tabUntilFocused } from "./support/keyboard.ts";
import { createTextQuestions, promptOf } from "./support/question-input.ts";

test.describe("E21 reordering by keyboard", () => {
  test("a drag handle reached with Tab moves a question with Space and the arrow keys, announces each step, and the order persists through If-Match", async ({
    api,
    admin,
    page,
  }) => {
    const questions = await createTextQuestions(api, ["E21 first", "E21 second", "E21 third"]);
    const [firstPrompt, secondPrompt, thirdPrompt] = questions.map(promptOf);
    if (firstPrompt === undefined || secondPrompt === undefined || thirdPrompt === undefined) throw new Error("Expected three prompts");
    const { questionnaireId } = await api.createQuestionnaire({ name: uniqueName("E21 keyboard reorder"), title: "E21 keyboard reorder" });
    const placed = await api.placeItems(
      questionnaireId,
      questions.map((question, index) => ({ itemId: `itm_e21_${index + 1}`, question })),
    );

    await admin.openDraftEditor(questionnaireId);
    await admin.expectDraftItemOrder([firstPrompt, secondPrompt, thirdPrompt]);

    const handle = admin.dragHandle(1);
    await tabUntilFocused(page, handle);
    await expect(handle).toBeFocused();

    const write = waitForDefinitionResponse(page, definitionApi.replaceDraft, { id: questionnaireId });
    await admin.moveItemByKeyboard({ prompt: firstPrompt, from: 1, to: 3, total: 3 });
    await expect(admin.reorderLiveRegion()).toHaveText(`Question “${firstPrompt}” was dropped in position 3 of 3.`);

    const response = await write;
    expect(response.status()).toBe(200);
    expect(await response.request().headerValue("if-match")).toBe(placed.etag);
    const savedEtag = await response.headerValue("etag");
    expect(savedEtag).not.toBeNull();
    expect(parseDraftEtag(savedEtag ?? "")?.draftRevision).toBe((parseDraftEtag(placed.etag)?.draftRevision ?? 0) + 1);

    const reordered = [secondPrompt, thirdPrompt, firstPrompt];
    await admin.expectDraftItemOrder(reordered);
    await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

    await page.reload();
    await expect(admin.publishButton()).toBeVisible();
    await admin.expectDraftItemOrder(reordered);

    const persisted = await api.getDraft(questionnaireId);
    expect(persisted.etag).toBe(savedEtag);
    expect(persisted.draft.items.map((item) => item.itemId)).toEqual(["itm_e21_2", "itm_e21_3", "itm_e21_1"]);
  });
});
