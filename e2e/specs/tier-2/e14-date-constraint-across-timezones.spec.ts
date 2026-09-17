import { addDays, calendarDateIn, dayNumber, SERVER_RELATIVE_DATE_TOLERANCE_DAYS } from "@qp/shared";
import { createDemoShapedQuestionnaire, DEMO_ITEM_IDS, DEMO_OPTION_IDS, DEMO_V1, expect, test } from "../../fixtures/index.ts";
import { answerYesPath } from "./support/demo-answers.ts";
import { ITEM_ERROR_MESSAGES } from "./support/respondent-messages.ts";
import { recordSubmitRequests, waitForSubmitResponse } from "./support/submit-traffic.ts";

const MILLISECONDS_PER_HOUR = 3_600_000;

interface TimezoneScenario {
  readonly timeZone: string;
  readonly utcHoursIntoRealToday: number;
}

const SCENARIOS: readonly TimezoneScenario[] = [
  { timeZone: "Pacific/Auckland", utcHoursIntoRealToday: 12.5 },
  { timeZone: "Pacific/Honolulu", utcHoursIntoRealToday: 3 },
];

function browserInstantFor(scenario: TimezoneScenario): { realUtcToday: string; instant: Date } {
  const realUtcToday = calendarDateIn(new Date(), "UTC");
  const startOfRealUtcToday = Date.parse(`${realUtcToday}T00:00:00.000Z`);
  return { realUtcToday, instant: new Date(startOfRealUtcToday + scenario.utcHoursIntoRealToday * MILLISECONDS_PER_HOUR) };
}

for (const scenario of SCENARIOS) {
  test.describe(`E14 — the date constraint across a timezone boundary (${scenario.timeZone})`, () => {
    test.use({ timezoneId: scenario.timeZone });

    test("browser-local tomorrow is refused before any request, and browser-local today is accepted by the control and the server", async ({
      page,
      api,
      respondent,
      db,
    }) => {
      const { realUtcToday, instant } = browserInstantFor(scenario);
      const localToday = calendarDateIn(instant, scenario.timeZone);
      const localTomorrow = addDays(localToday, 1);
      expect(localToday).not.toBe(calendarDateIn(instant, "UTC"));
      expect(dayNumber(localToday) - dayNumber(realUtcToday)).toBeLessThanOrEqual(SERVER_RELATIVE_DATE_TOLERANCE_DAYS);

      const demo = await createDemoShapedQuestionnaire(api);
      await page.clock.setFixedTime(instant);
      const submitRequests = recordSubmitRequests(page);
      await respondent.openForm(demo.questionnaireId);
      expect(await page.evaluate(() => ({ now: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }))).toEqual({
        now: instant.toISOString(),
        timeZone: scenario.timeZone,
      });
      const { sessionId } = await respondent.waitForEnvelope(demo.questionnaireId);

      await answerYesPath(respondent, { condition: DEMO_OPTION_IDS.diabetes, diagnosedOn: localTomorrow, pharmacy: "Corner pharmacy" });
      const diagnosedOn = page.getByLabel(DEMO_V1.prompts.diagnosedOn);
      await expect(diagnosedOn).toHaveValue(localTomorrow);

      await respondent.submit();
      await expect(diagnosedOn).toHaveAttribute("aria-invalid", "true");
      await expect(diagnosedOn).toHaveAccessibleDescription(ITEM_ERROR_MESSAGES.notInFuture);
      await expect(diagnosedOn).toBeFocused();
      await expect(respondent.errorSummary().getByRole("listitem")).toHaveText([
        `${DEMO_V1.prompts.diagnosedOn} — ${ITEM_ERROR_MESSAGES.notInFuture}`,
      ]);
      expect(submitRequests).toHaveLength(0);

      await respondent.fillDate(DEMO_V1.prompts.diagnosedOn, localToday);
      await expect(diagnosedOn).not.toHaveAttribute("aria-invalid", "true");
      await expect(respondent.errorSummary()).toHaveCount(0);

      const accepted = waitForSubmitResponse(page);
      await respondent.submit();
      expect((await accepted).status()).toBe(200);
      expect((await respondent.expectReceipt()).sessionId).toBe(sessionId);
      expect(submitRequests).toHaveLength(1);

      const rows = await db.responsesFor(sessionId);
      expect(rows.find((row) => row.itemId === DEMO_ITEM_IDS.diagnosedOn)).toMatchObject({ dateValue: localToday });
    });
  });
}
