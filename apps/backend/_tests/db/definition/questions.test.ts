import type { QuestionInput } from "@qp/shared";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { listQuestionVersionSummaries } from "../../../src/db/definition/question-reads.js";
import { appendQuestionVersion, createQuestion } from "../../../src/db/definition/questions.js";
import { actor, aTextQuestion, theStatementWaitingOnALock, whileHoldingALock } from "../fixtures.js";
import { useTestDatabase } from "../harness.js";

const testDatabase = useTestDatabase();

const QUESTION_LOCK_STATEMENT = /from "definition"\."question" where "definition"\."question"\."id" = \$1 for update$/;

const aChoiceQuestion: QuestionInput = {
  type: "single_choice",
  prompt: "Which condition?",
  options: [{ optionId: "opt_alpha", label: "Alpha" }],
};

describe("appendQuestionVersion", () => {
  it("refuses a version whose type differs from the latest, writing no version and no audit row", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const auditBefore = await testDatabase.readAuditEvents();

    const outcome = await appendQuestionVersion(db, { questionId: created.questionId, content: aChoiceQuestion, ...actor });

    expect(outcome).toEqual({ outcome: "type-changed" });
    expect(await listQuestionVersionSummaries(db, created.questionId)).toMatchObject([{ questionVersion: 1, type: "text" }]);
    expect(await testDatabase.readAuditEvents()).toEqual(auditBefore);
  });

  it("saves the next version when the type is unchanged", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestion(db, { key: null, content: aChoiceQuestion, ...actor });

    const outcome = await appendQuestionVersion(db, { questionId: created.questionId, content: { ...aChoiceQuestion, prompt: "Revised" }, ...actor });

    expect(outcome).toMatchObject({ outcome: "saved", questionVersion: 2, question: { latest: { type: "single_choice", prompt: "Revised" } } });
  });

  it("reports an unknown question as not found before comparing types", async () => {
    const db = testDatabase.database("definition");

    expect(await appendQuestionVersion(db, { questionId: uuidv7(), content: aChoiceQuestion, ...actor })).toEqual({
      outcome: "question-not-found",
    });
  });

  it("takes the question lock before reading the latest type, so it compares against the version a concurrent save just wrote", async () => {
    const db = testDatabase.database("definition");
    const created = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const events: string[] = [];
    let changing: Promise<unknown> = Promise.resolve();

    await whileHoldingALock(
      db,
      (tx) => appendQuestionVersion(tx, { questionId: created.questionId, content: { type: "text", prompt: "Held" }, ...actor }),
      async () => {
        changing = appendQuestionVersion(db, { questionId: created.questionId, content: aChoiceQuestion, ...actor }).then((outcome) =>
          events.push(`type change returned ${outcome.outcome}`),
        );
        expect(await theStatementWaitingOnALock(testDatabase)).toMatch(QUESTION_LOCK_STATEMENT);
        events.push("lock holder commits");
      },
    );
    await changing;

    expect(events).toEqual(["lock holder commits", "type change returned type-changed"]);
    expect(await listQuestionVersionSummaries(db, created.questionId)).toMatchObject([
      { questionVersion: 2, type: "text" },
      { questionVersion: 1, type: "text" },
    ]);
  });
});
