import type { Locator } from "@playwright/test";
import { definitionApi, type DraftItem, type Item, type Question } from "@qp/shared";
import { expect, test, uniqueName, type DefinitionApi } from "../../fixtures/index.ts";
import {
  draftItemList,
  draftItemRow,
  problemReplyOfExchange,
  promptOf,
  textQuestionInput,
  waitForDefinitionResponse,
  YES_NO_OPTION_IDS,
  yesNoQuestionInput,
} from "./support/authoring.ts";

const ITEM_IDS = { gate: "itm_gate", followUp: "itm_follow_up" } as const;

const EDITING_CONTROL_NAMES = /^(Publish|Add question|Edit|Remove question|Drag to reorder|Rules for question|Re-pin question|Save as version|Open the next draft|New question)/;

interface PublishedFixture {
  readonly questionnaireId: string;
  readonly name: string;
  readonly title: string;
  readonly gate: Question;
  readonly followUp: Question;
  readonly publishedDraftEtag: string;
}

async function publishGatedQuestionnaire(api: DefinitionApi, label: string): Promise<PublishedFixture> {
  const gate = await api.createQuestion(yesNoQuestionInput(`${label} gate`));
  const followUp = await api.createQuestion(textQuestionInput(`${label} follow-up`));
  const name = uniqueName(label);
  const title = `${label} title`;
  const { questionnaireId } = await api.createQuestionnaire({ name, title });
  const { etag } = await api.placeItems(questionnaireId, [
    { itemId: ITEM_IDS.gate, question: gate },
    {
      itemId: ITEM_IDS.followUp,
      question: followUp,
      required: false,
      visibleWhen: { all: [{ type: "single_choice", itemId: ITEM_IDS.gate, op: "is", optionId: YES_NO_OPTION_IDS.yes }] },
    },
  ]);
  await api.publishDraft(questionnaireId, etag);
  return { questionnaireId, name, title, gate, followUp, publishedDraftEtag: etag };
}

function formControlsIn(scope: Locator): Locator {
  return scope
    .getByRole("textbox")
    .or(scope.getByRole("radio"))
    .or(scope.getByRole("checkbox"))
    .or(scope.getByRole("spinbutton"))
    .or(scope.getByRole("combobox"));
}

function asDraftItem({ itemId, required, visibleWhen, question }: Item): DraftItem {
  return { itemId, required, visibleWhen, questionId: question.questionId, questionVersion: question.questionVersion };
}

test.describe("E25 a published version is not editable", () => {
  test("the published version view offers no editing affordance", async ({ api, admin, page }) => {
    const published = await publishGatedQuestionnaire(api, "E25 read-only view");

    await admin.openVersionHistory(published.questionnaireId);
    await page.getByRole("link", { name: "Preview version 1", exact: true }).click();
    await expect(admin.heading("Preview of version 1")).toBeVisible();

    const main = page.getByRole("main");
    const snapshot = main.getByRole("region", { name: published.title, exact: true });
    const sampleAnswers = main.getByRole("region", { name: "Sample answers", exact: true });
    await expect(snapshot.getByRole("radiogroup", { name: promptOf(published.gate) })).toBeVisible();

    await expect(main.getByRole("button", { name: EDITING_CONTROL_NAMES })).toHaveCount(0);
    await expect(main.getByRole("checkbox", { name: "Required" })).toHaveCount(0);
    await expect(draftItemList(page)).toHaveCount(0);
    await expect(snapshot.getByRole("button", { name: "Submit answers", exact: true })).toBeDisabled();

    const snapshotRadios = snapshot.getByRole("radio");
    await expect(snapshotRadios).toHaveCount(2);
    for (const radio of await snapshotRadios.all()) {
      await expect(radio).toBeDisabled();
    }
    await expect(snapshot.getByRole("textbox")).toHaveCount(0);

    const sampleGate = sampleAnswers.getByRole("group", { name: `1. ${promptOf(published.gate)}`, exact: true });
    await sampleGate.getByRole("radio", { name: "Yes", exact: true }).check();
    const revealedFollowUp = snapshot.getByRole("textbox", { name: promptOf(published.followUp) });
    await expect(revealedFollowUp).toBeVisible();
    await expect(revealedFollowUp).not.toBeEditable();
    const snapshotControls = await formControlsIn(snapshot).count();
    const sampleAnswerControls = await formControlsIn(sampleAnswers).count();
    expect(await formControlsIn(main).count()).toBe(snapshotControls + sampleAnswerControls);
  });

  test("opening the next draft copies every item with its pins, even when the bank has moved on", async ({ api, admin, page }) => {
    const published = await publishGatedQuestionnaire(api, "E25 next draft");
    const followUpV2 = await api.createQuestionVersion(published.followUp.questionId, textQuestionInput("E25 next draft follow-up, reworded"));
    expect(followUpV2.questionVersion).toBe(2);

    await admin.openVersionHistory(published.questionnaireId);
    const opened = waitForDefinitionResponse(page, definitionApi.openDraft, { id: published.questionnaireId });
    await page.getByRole("button", { name: "Open the next draft", exact: true }).click();
    expect((await opened).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/questionnaires/${published.questionnaireId}/draft$`));

    const followUpRow = draftItemRow(page, 2, promptOf(published.followUp));
    await expect(followUpRow.getByText("Text · pinned v1 · Shown when 1 condition is true")).toBeVisible();
    await expect(followUpRow.getByText("Newer version available")).toBeVisible();

    const snapshot = await api.getVersion(published.questionnaireId, 1);
    const { draft } = await api.getDraft(published.questionnaireId);
    expect(draft.title).toBe(snapshot.title);
    expect(draft.items).toEqual(snapshot.items.map(asDraftItem));
    expect(draft.items.map((item) => item.questionVersion)).toEqual([1, 1]);
  });

  test("no HTTP write reaches a published version, and the database refuses one with QP001", async ({ api, db }) => {
    const published = await publishGatedQuestionnaire(api, "E25 direct write");
    const { questionnaireId } = published;
    const snapshotBefore = await api.getVersion(questionnaireId, 1);
    const [publishedRowBefore] = await db.versionsOf(questionnaireId);
    const rewrite = { title: "Rewritten after publishing", items: [] };

    const putToVersion = await api.send({ ...definitionApi.getVersion, method: "PUT" }, { params: { id: questionnaireId, v: 1 }, body: rewrite });
    expect(problemReplyOfExchange(putToVersion)).toMatchObject({ status: 404, slug: "resource/not-found" });

    const replayWithoutDraft = await api.send(definitionApi.replaceDraft, {
      params: { id: questionnaireId },
      ifMatch: published.publishedDraftEtag,
      body: rewrite,
    });
    expect(problemReplyOfExchange(replayWithoutDraft)).toMatchObject({ status: 404, slug: "resource/not-found" });

    const nextDraft = await api.openDraft(questionnaireId);
    const replayOverNextDraft = await api.send(definitionApi.replaceDraft, {
      params: { id: questionnaireId },
      ifMatch: published.publishedDraftEtag,
      body: rewrite,
    });
    expect(problemReplyOfExchange(replayOverNextDraft)).toMatchObject({ status: 409, slug: "questionnaire/draft-stale" });
    expect(await api.getDraft(questionnaireId)).toEqual(nextDraft);

    await expect(
      db.query("UPDATE definition.questionnaire_version SET title = $2 WHERE id = $1", [publishedRowBefore?.questionnaireVersionId, rewrite.title]),
    ).rejects.toMatchObject({ code: "QP001" });

    expect(await api.getVersion(questionnaireId, 1)).toEqual(snapshotBefore);
    const [publishedRowAfter] = await db.versionsOf(questionnaireId);
    expect(publishedRowAfter).toEqual(publishedRowBefore);
  });
});
