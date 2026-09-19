import { expect, test, uniqueName, type Placement } from "../../fixtures/index";
import { promptOf, textQuestionInput, YES_NO_OPTION_IDS, yesNoQuestionInput } from "./support/question-input";

const ITEM_IDS = { gate: "itm_gate", detail: "itm_detail", notes: "itm_notes", contact: "itm_contact" } as const;

test.describe("E27 — a hidden-by-rules item, an unanswered item and an answered item all render distinctly", () => {
  test("the responses list and session detail tell hidden, unanswered and answered apart, and an in-progress session stores nothing yet", async ({
    api,
    execution,
    admin,
    page,
  }) => {
    const [gate, detail, notes, contact] = await Promise.all([
      api.createQuestion(yesNoQuestionInput("Do you have any allergies?")),
      api.createQuestion(textQuestionInput("List your allergies")),
      api.createQuestion(textQuestionInput("Anything else we should know?")),
      api.createQuestion(textQuestionInput("Preferred contact")),
    ]);

    const placements: Placement[] = [
      { itemId: ITEM_IDS.gate, question: gate },
      {
        itemId: ITEM_IDS.detail,
        question: detail,
        visibleWhen: { all: [{ type: "single_choice", itemId: ITEM_IDS.gate, op: "is", optionId: YES_NO_OPTION_IDS.yes }] },
      },
      { itemId: ITEM_IDS.notes, question: notes, required: false },
      { itemId: ITEM_IDS.contact, question: contact },
    ];
    const published = await api.createPublishedQuestionnaire({ name: uniqueName("E27 visibility"), title: "Allergy intake" }, placements);
    const questionnaireId = published.questionnaire.questionnaireId;

    const submitted = await execution.createSession(questionnaireId);
    await execution.submit(submitted.session.sessionId, {
      [ITEM_IDS.gate]: { type: "single_choice", optionId: YES_NO_OPTION_IDS.no },
      [ITEM_IDS.contact]: { type: "text", text: "Call me anytime" },
    });

    const inProgress = await execution.createSession(questionnaireId);

    await admin.openResponsesList(questionnaireId);
    const submittedRow = admin.sessionRow(submitted.session.sessionId);
    await expect(submittedRow).toContainText("2 of 4");
    await expect(submittedRow).toContainText("1 hidden by rules");
    const inProgressRow = admin.sessionRow(inProgress.session.sessionId);
    await expect(inProgressRow).toContainText("In progress");
    await expect(inProgressRow).toContainText("Not stored until submit");

    await admin.statusFilter().selectOption("submitted");
    await expect(admin.sessionRow(submitted.session.sessionId)).toBeVisible();
    await expect(admin.sessionRow(inProgress.session.sessionId)).toHaveCount(0);

    await admin.statusFilter().selectOption("in_progress");
    await expect(admin.sessionRow(inProgress.session.sessionId)).toBeVisible();
    await expect(admin.sessionRow(submitted.session.sessionId)).toHaveCount(0);

    await admin.statusFilter().selectOption("");
    await expect(admin.sessionRow(submitted.session.sessionId)).toBeVisible();
    await expect(admin.sessionRow(inProgress.session.sessionId)).toBeVisible();

    await admin.openResponseDetail(questionnaireId, submitted.session.sessionId);
    const gateItem = page.getByRole("listitem").filter({ hasText: promptOf(gate) });
    await expect(gateItem.getByText("No", { exact: true })).toBeVisible();
    const detailItem = page.getByRole("listitem").filter({ hasText: promptOf(detail) });
    await expect(detailItem).toContainText("Hidden by rules");
    const notesItem = page.getByRole("listitem").filter({ hasText: promptOf(notes) });
    await expect(notesItem).toContainText("Not answered");
    const contactItem = page.getByRole("listitem").filter({ hasText: promptOf(contact) });
    await expect(contactItem.getByText("Call me anytime", { exact: true })).toBeVisible();

    await admin.openResponseDetail(questionnaireId, inProgress.session.sessionId);
    await expect(page.getByText("No answers are stored for this session yet", { exact: true })).toBeVisible();
    const inProgressGateItem = page.getByRole("listitem").filter({ hasText: promptOf(gate) });
    await expect(inProgressGateItem).toContainText("Not stored until submit");
    const inProgressDetailItem = page.getByRole("listitem").filter({ hasText: promptOf(detail) });
    await expect(inProgressDetailItem).toContainText("Not stored until submit");
    await expect(inProgressDetailItem).not.toContainText("Hidden by rules");
  });
});
