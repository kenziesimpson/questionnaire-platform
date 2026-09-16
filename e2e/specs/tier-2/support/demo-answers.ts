import { DEMO_OPTION_IDS, DEMO_V1, type DemoOptionId, type RespondentPage } from "../../../fixtures/index.ts";

export const RESTORED_ANSWERS_NOTICE = "We restored the answers you started on this device.";

export async function answerNoPath(respondent: RespondentPage, pharmacy: string): Promise<void> {
  await respondent.choose(DEMO_V1.prompts.hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.no));
  await respondent.fillText(DEMO_V1.prompts.pharmacy, pharmacy);
}

export interface YesPathAnswers {
  readonly condition: DemoOptionId;
  readonly diagnosedOn: string;
  readonly pharmacy: string;
}

export async function answerYesPath(respondent: RespondentPage, answers: YesPathAnswers): Promise<void> {
  await respondent.choose(DEMO_V1.prompts.hasCondition, DEMO_V1.optionLabel(DEMO_OPTION_IDS.yes));
  await respondent.choose(DEMO_V1.prompts.whichCondition, DEMO_V1.optionLabel(answers.condition));
  await respondent.fillDate(DEMO_V1.prompts.diagnosedOn, answers.diagnosedOn);
  await respondent.fillText(DEMO_V1.prompts.pharmacy, answers.pharmacy);
}
