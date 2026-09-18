import { INTAKE_QUESTIONNAIRE_ID } from "@qp/shared/demo";
import { describe, expect, it } from "vitest";
import { questionnaireIdFromPath } from "../../src/entry/questionnaire-path";

describe("questionnaireIdFromPath", () => {
  it.each([`/q/${INTAKE_QUESTIONNAIRE_ID}`, `/q/${INTAKE_QUESTIONNAIRE_ID}/`])("reads the questionnaire id from %s", (pathname) => {
    expect(questionnaireIdFromPath(pathname)).toBe(INTAKE_QUESTIONNAIRE_ID);
  });

  it.each([
    "/",
    "/q",
    "/q/",
    "/q/not-a-uuid",
    `/q/${INTAKE_QUESTIONNAIRE_ID}/extra`,
    `/s/${INTAKE_QUESTIONNAIRE_ID}`,
    `/admin/q/${INTAKE_QUESTIONNAIRE_ID}`,
    "/q/%E0%A4%A",
  ])("reads nothing from %s", (pathname) => {
    expect(questionnaireIdFromPath(pathname)).toBeUndefined();
  });
});
