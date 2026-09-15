import { definitionApi, type Question } from "@qp/shared";
import { expect, test, uniqueName, type DefinitionApi, type Placement } from "../../fixtures/index.ts";
import {
  createTextQuestions,
  draftItemRow,
  definitionUrlPattern,
  problemReplyOfResponse,
  promptOf,
  recordDefinitionRequests,
  waitForDefinitionResponse,
  YES_NO_OPTION_IDS,
  yesNoQuestionInput,
} from "./support/authoring.ts";

const ITEM_IDS = { gate: "itm_gate", forwardReference: "itm_forward", unsatisfiable: "itm_never" } as const;

const EXPECTED_PROBLEMS = [
  { itemId: ITEM_IDS.forwardReference, code: "predicate/forward-reference" },
  { itemId: ITEM_IDS.unsatisfiable, code: "predicate/unsatisfiable" },
] as const;

interface InvalidDraft {
  readonly questionnaireId: string;
  readonly forwardReferencePrompt: string;
  readonly unsatisfiablePrompt: string;
}

function invalidPlacements(gate: Question, forwardReference: Question, unsatisfiable: Question): Placement[] {
  return [
    { itemId: ITEM_IDS.gate, question: gate },
    {
      itemId: ITEM_IDS.forwardReference,
      question: forwardReference,
      visibleWhen: { all: [{ type: "text", itemId: ITEM_IDS.unsatisfiable, op: "answered", value: true }] },
    },
    {
      itemId: ITEM_IDS.unsatisfiable,
      question: unsatisfiable,
      visibleWhen: {
        all: [
          { type: "single_choice", itemId: ITEM_IDS.gate, op: "is", optionId: YES_NO_OPTION_IDS.yes },
          { type: "single_choice", itemId: ITEM_IDS.gate, op: "is", optionId: YES_NO_OPTION_IDS.no },
        ],
      },
    },
  ];
}

async function arrangeInvalidDraft(api: DefinitionApi): Promise<InvalidDraft> {
  const gate = await api.createQuestion(yesNoQuestionInput("E19 gate"));
  const [forwardReference, unsatisfiable] = await createTextQuestions(api, ["E19 reads a later answer", "E19 never shown"]);
  if (forwardReference === undefined || unsatisfiable === undefined) throw new Error("Expected two bank questions");
  const { questionnaireId } = await api.createQuestionnaire({ name: uniqueName("E19 invalid draft"), title: "E19 invalid draft" });
  await api.placeItems(questionnaireId, invalidPlacements(gate, forwardReference, unsatisfiable));
  expect(await api.validateDraft(questionnaireId)).toEqual({ valid: false, items: EXPECTED_PROBLEMS });
  return { questionnaireId, forwardReferencePrompt: promptOf(forwardReference), unsatisfiablePrompt: promptOf(unsatisfiable) };
}

test.describe("E19 publish-time validation has a usable surface", () => {
  test("the publish checks panel lists both problems with jump-to-item buttons and holds Publish back", async ({ api, admin, page }) => {
    const draft = await arrangeInvalidDraft(api);

    await admin.openDraftEditor(draft.questionnaireId);

    const checks = page.getByRole("region", { name: "Publish checks", exact: true });
    const problems = checks.getByRole("list", { name: "Problems", exact: true });
    await expect(checks.getByText("Fix 2 problems in 2 questions to publish.")).toBeVisible();
    await expect(problems.getByText("Rule uses a later question", { exact: true })).toBeVisible();
    await expect(problems.getByText("Rules can never be met", { exact: true })).toBeVisible();
    await expect(admin.publishButton()).toBeDisabled();
    await expect(page.getByText("2 problems under")).toBeVisible();

    const jumpToForwardReference = problems.getByRole("button", { name: `Go to question 2, “${draft.forwardReferencePrompt}”`, exact: true });
    const jumpToUnsatisfiable = problems.getByRole("button", { name: `Go to question 3, “${draft.unsatisfiablePrompt}”`, exact: true });
    await expect(jumpToForwardReference).toBeVisible();
    await expect(jumpToUnsatisfiable).toBeVisible();

    await jumpToUnsatisfiable.click();
    const unsatisfiableRow = draftItemRow(page, 3, draft.unsatisfiablePrompt);
    await expect(unsatisfiableRow.getByRole("button", { name: "Rules for question 3", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(unsatisfiableRow.getByRole("group", { name: "Rules for question 3", exact: true })).toBeFocused();

    await jumpToForwardReference.click();
    const forwardReferenceRow = draftItemRow(page, 2, draft.forwardReferencePrompt);
    await expect(forwardReferenceRow.getByRole("group", { name: "Rules for question 2", exact: true })).toBeFocused();
    await expect(forwardReferenceRow.getByText("A condition uses question 3, which is now below this question.")).toBeVisible();

    expect(await api.listVersions(draft.questionnaireId)).toEqual([]);
  });

  test("a publish the server refuses answers 422 draft-invalid, lands on the summary panel and publishes nothing", async ({
    api,
    admin,
    db,
    page,
  }) => {
    const draft = await arrangeInvalidDraft(api);
    const versionsBefore = await db.versionsOf(draft.questionnaireId);

    const publishRequests = recordDefinitionRequests(page, definitionApi.publishDraft, { id: draft.questionnaireId });
    await page.route(definitionUrlPattern(definitionApi.validateDraft, { id: draft.questionnaireId }), async (route) => {
      if (publishRequests.length > 0) await route.continue();
      else await route.fulfill({ json: { valid: true, items: [] } });
    });

    await admin.openDraftEditor(draft.questionnaireId);
    await expect(admin.publishButton()).toBeEnabled();

    const publishReply = waitForDefinitionResponse(page, definitionApi.publishDraft, { id: draft.questionnaireId });
    await admin.publishButton().click();
    const refusal = await problemReplyOfResponse(await publishReply);
    expect(refusal.status).toBe(422);
    expect(refusal.slug).toBe("questionnaire/draft-invalid");
    expect(refusal.problem?.items).toEqual(EXPECTED_PROBLEMS);

    const notice = page.getByRole("alert").filter({ hasText: "The draft was not published" });
    await expect(notice).toContainText("Publishing found 2 problems. They are listed under Publish checks.");
    await expect(notice.getByRole("button", { name: "Show problems", exact: true })).toBeVisible();

    const checksHeading = page.getByRole("heading", { name: "Publish checks", exact: true });
    await expect(checksHeading).toBeFocused();
    const problems = page.getByRole("region", { name: "Publish checks", exact: true }).getByRole("list", { name: "Problems", exact: true });
    await expect(problems.getByRole("button", { name: `Go to question 2, “${draft.forwardReferencePrompt}”`, exact: true })).toBeVisible();
    await expect(problems.getByRole("button", { name: `Go to question 3, “${draft.unsatisfiablePrompt}”`, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/questionnaires/${draft.questionnaireId}/draft$`));

    expect(await db.publishedVersionCount(draft.questionnaireId)).toBe(0);
    expect(await api.listVersions(draft.questionnaireId)).toEqual([]);
    expect(await db.versionsOf(draft.questionnaireId)).toEqual(versionsBefore);
  });
});
