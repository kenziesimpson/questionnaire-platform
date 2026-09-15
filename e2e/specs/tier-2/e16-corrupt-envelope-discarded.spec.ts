import {
  createDemoShapedQuestionnaire,
  DEMO_ITEM_IDS,
  DEMO_OPTION_IDS,
  DEMO_V1,
  expect,
  RESPONDENT_STORAGE_FORMAT_VERSION,
  test,
  type ExecutionApi,
} from "../../fixtures/index.ts";
import { answerNoPath, RESTORED_ANSWERS_NOTICE } from "./support/demo-answers.ts";
import { recordSubmitRequests, submitBodyOf } from "./support/submit-traffic.ts";

const PLANTED_PHARMACY = "planted-pharmacy-5c21e0";

interface BadEnvelope {
  readonly name: string;
  readonly plant: (questionnaireId: string, execution: ExecutionApi) => Promise<{ text: string; foreignSessionId: string | null }>;
}

const BAD_ENVELOPES: readonly BadEnvelope[] = [
  {
    name: "a bumped formatVersion",
    plant: async (questionnaireId, execution) => {
      const { session } = await execution.createSession(questionnaireId);
      const futureEnvelope = {
        formatVersion: RESPONDENT_STORAGE_FORMAT_VERSION + 1,
        sessionId: session.sessionId,
        questionnaireId,
        answers: {
          [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.yes },
          [DEMO_ITEM_IDS.pharmacy]: { type: "text", text: PLANTED_PHARMACY },
        },
        updatedAt: new Date().toISOString(),
      };
      return { text: JSON.stringify(futureEnvelope), foreignSessionId: session.sessionId };
    },
  },
  {
    name: "garbage",
    plant: async () => ({ text: `{"formatVersion":1,"answers":{"${DEMO_ITEM_IDS.pharmacy}":"${PLANTED_PHARMACY}"`, foreignSessionId: null }),
  },
];

for (const badEnvelope of BAD_ENVELOPES) {
  test.describe(`E16 — a corrupt or foreign storage envelope is discarded (${badEnvelope.name})`, () => {
    test("the app starts a clean session instead of crashing, and nothing from the bad envelope reaches the submit body", async ({
      page,
      api,
      execution,
      respondent,
      db,
      browserErrors,
    }) => {
      const demo = await createDemoShapedQuestionnaire(api);
      await respondent.clearStoredValue(demo.questionnaireId);
      expect(await respondent.readStoredValue(demo.questionnaireId)).toEqual({ kind: "absent" });

      const { text, foreignSessionId } = await badEnvelope.plant(demo.questionnaireId, execution);
      await respondent.writeStoredValue(demo.questionnaireId, text);
      expect(await respondent.readStoredValue(demo.questionnaireId)).toEqual({ kind: "unrecognised", raw: text });

      const submitRequests = recordSubmitRequests(page);
      await respondent.openForm(demo.questionnaireId);

      const fresh = await respondent.waitForEnvelope(demo.questionnaireId);
      expect(fresh.sessionId).not.toBe(foreignSessionId);
      expect(fresh.answers).toEqual({});
      expect(await db.session(fresh.sessionId)).toMatchObject({ questionnaireId: demo.questionnaireId, status: "in_progress" });

      await expect(page.getByText(RESTORED_ANSWERS_NOTICE)).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: DEMO_V1.prompts.pharmacy })).toHaveValue("");
      await expect(respondent.option(DEMO_V1.prompts.hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes))).not.toBeChecked();
      await expect(respondent.question(DEMO_V1.prompts.whichCondition)).toHaveCount(0);

      await answerNoPath(respondent, "Corner pharmacy");
      const receipt = await respondent.submitAndExpectReceipt();
      expect(receipt.sessionId).toBe(fresh.sessionId);

      expect(submitRequests).toHaveLength(1);
      const [submitRequest] = submitRequests;
      if (submitRequest === undefined) throw new Error("The submit request was not recorded");
      expect(submitRequest.url()).toContain(fresh.sessionId);
      expect(submitRequest.postData()).not.toContain(PLANTED_PHARMACY);
      expect(submitBodyOf(submitRequest).answers).toEqual({
        [DEMO_ITEM_IDS.hasCondition]: { type: "single_choice", optionId: DEMO_OPTION_IDS.no },
        [DEMO_ITEM_IDS.pharmacy]: { type: "text", text: "Corner pharmacy" },
      });

      expect(await db.responsesFor(fresh.sessionId)).toMatchObject([
        { itemId: DEMO_ITEM_IDS.hasCondition, optionIds: [DEMO_OPTION_IDS.no] },
        { itemId: DEMO_ITEM_IDS.pharmacy, textValue: "Corner pharmacy" },
      ]);
      if (foreignSessionId !== null) {
        expect(await db.session(foreignSessionId)).toMatchObject({ status: "in_progress", submittedAt: null });
        expect(await db.responsesFor(foreignSessionId)).toEqual([]);
      }
      expect(browserErrors.pageErrors).toEqual([]);
    });
  });
}
