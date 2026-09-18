import type { APIResponse } from "@playwright/test";
import { definitionApi } from "@qp/shared";
import { Deferred, definitionUrlPattern, expect, problemReplyOfResponse, uniqueName, waitForDefinitionResponse } from "../../fixtures/index.ts";
import { createTextQuestions, promptOf } from "./support/question-input.ts";
import { testWithSecondAdmin as test } from "./support/second-admin.ts";

test.describe("E20 two admins on one draft", () => {
  test("a reorder on a stale ETag gets 409 draft-stale, rolls back, says someone else changed it, and reloads the other admin's draft", async ({
    api,
    admin,
    page,
    secondAdmin,
  }) => {
    const questions = await createTextQuestions(api, ["E20 first", "E20 second", "E20 third"]);
    const prompts = questions.map(promptOf);
    const [firstPrompt, secondPrompt, thirdPrompt] = prompts;
    if (firstPrompt === undefined || secondPrompt === undefined || thirdPrompt === undefined) throw new Error("Expected three prompts");
    const { questionnaireId } = await api.createQuestionnaire({ name: uniqueName("E20 shared draft"), title: "E20 shared draft" });
    await api.placeItems(
      questionnaireId,
      questions.map((question, index) => ({ itemId: `itm_e20_${index + 1}`, question })),
    );
    const pageB = secondAdmin.page;

    await admin.openDraftEditor(questionnaireId);
    await secondAdmin.openDraftEditor(questionnaireId);
    const orderBeforeReorder = [firstPrompt, secondPrompt, thirdPrompt];
    await secondAdmin.expectDraftItemOrder(orderBeforeReorder);

    const saveA = waitForDefinitionResponse(page, definitionApi.replaceDraft, { id: questionnaireId });
    await admin.draftItemRow(3, thirdPrompt).getByRole("checkbox", { name: "Required", exact: true }).click();
    expect((await saveA).status()).toBe(200);
    const stateA = await api.getDraft(questionnaireId);
    expect(stateA.draft.items.map((item) => item.required)).toEqual([true, true, false]);

    const serverAnswered = new Deferred<APIResponse>();
    const releaseAnswer = new Deferred<void>();
    await pageB.route(definitionUrlPattern(definitionApi.replaceDraft, { id: questionnaireId }), async (route) => {
      const response = await route.fetch();
      serverAnswered.resolve(response);
      await releaseAnswer.promise;
      await route.fulfill({ response });
    });

    const writeB = waitForDefinitionResponse(pageB, definitionApi.replaceDraft, { id: questionnaireId });
    await secondAdmin.dragHandle(1).focus();
    await secondAdmin.moveItemByKeyboard({ prompt: firstPrompt, from: 1, to: 2, total: 3 });

    expect((await serverAnswered.promise).status()).toBe(409);
    await secondAdmin.expectDraftItemOrder([secondPrompt, firstPrompt, thirdPrompt]);
    releaseAnswer.resolve();

    const conflict = await problemReplyOfResponse(await writeB);
    expect(conflict.status).toBe(409);
    expect(conflict.slug).toBe("questionnaire/draft-stale");

    const notice = pageB.getByRole("alert").filter({ hasText: "Someone else changed this draft" });
    await expect(notice).toContainText("Your last change was undone and the draft has been reloaded with their version, so carry on from there.");
    await secondAdmin.expectDraftItemOrder(orderBeforeReorder);
    await expect(secondAdmin.draftItemRow(3, thirdPrompt).getByRole("checkbox", { name: "Required", exact: true })).not.toBeChecked();
    await expect(secondAdmin.draftItemRow(1, firstPrompt).getByRole("checkbox", { name: "Required", exact: true })).toBeChecked();

    expect(await api.getDraft(questionnaireId)).toEqual(stateA);
  });
});
