import { definitionApi } from "@qp/shared";
import {
  expect,
  problemReplyOfResponse,
  recordDefinitionRequests,
  test,
  uniqueName,
  waitForDefinitionResponse,
  type DefinitionApi,
  type PublishedQuestionnaire,
} from "../../fixtures/index.ts";
import { textQuestionInput } from "./support/question-input.ts";

async function publishedWithoutDraft(api: DefinitionApi, label: string): Promise<PublishedQuestionnaire> {
  const question = await api.createQuestion(textQuestionInput(`${label} question`));
  const published = await api.createPublishedQuestionnaire({ name: uniqueName(label), title: label }, [{ itemId: "itm_only", question }]);
  expect(published.questionnaire.hasDraft).toBe(false);
  return published;
}

test.describe("E24 only one draft at a time", () => {
  test("opening a draft from a list that missed another tab's draft gets 409 draft-exists and continues editing that draft", async ({
    api,
    admin,
    db,
    page,
  }) => {
    const published = await publishedWithoutDraft(api, "E24 raced draft");
    const { questionnaireId, name } = published.questionnaire;

    await admin.openQuestionnaires();
    const row = admin.questionnaireRow(name);
    await expect(row.getByText("Draft open")).toHaveCount(0);

    const openedElsewhere = await api.openDraft(questionnaireId);

    const openAttempt = waitForDefinitionResponse(page, definitionApi.openDraft, { id: questionnaireId });
    await admin.openDraftButton(name).click();
    const conflict = await problemReplyOfResponse(await openAttempt);
    expect(conflict.status).toBe(409);
    expect(conflict.slug).toBe("questionnaire/draft-exists");

    await expect(page).toHaveURL(new RegExp(`/questionnaires/${questionnaireId}/draft$`));
    await expect(admin.publishButton()).toBeVisible();
    await expect(admin.heading(name)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("could not be opened")).toHaveCount(0);

    const versions = await db.versionsOf(questionnaireId);
    expect(versions.map((version) => version.status)).toEqual(["published", "draft"]);
    expect(versions.find((version) => version.status === "draft")?.questionnaireVersionId).toBe(openedElsewhere.draft.versionId);
    expect(await api.getDraft(questionnaireId)).toEqual(openedElsewhere);
  });

  test("a list that already shows the open draft continues editing it without asking for a second", async ({ api, admin, db, page }) => {
    const published = await publishedWithoutDraft(api, "E24 known draft");
    const { questionnaireId, name } = published.questionnaire;
    const opened = await api.openDraft(questionnaireId);

    await admin.openQuestionnaires();
    await expect(admin.questionnaireRow(name).getByText("Draft open", { exact: true })).toBeVisible();

    const openRequests = recordDefinitionRequests(page, definitionApi.openDraft, { id: questionnaireId });
    await admin.openDraftButton(name).click();

    await expect(page).toHaveURL(new RegExp(`/questionnaires/${questionnaireId}/draft$`));
    await expect(admin.publishButton()).toBeVisible();
    expect(openRequests).toEqual([]);

    const versions = await db.versionsOf(questionnaireId);
    expect(versions.map((version) => version.status)).toEqual(["published", "draft"]);
    expect(await api.getDraft(questionnaireId)).toEqual(opened);
  });
});
