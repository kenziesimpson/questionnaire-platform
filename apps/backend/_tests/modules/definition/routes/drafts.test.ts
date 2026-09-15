import {
  PROBLEM_CONTENT_TYPE,
  QuestionnaireDraft,
  formatDraftEtag,
  parseDraftEtag,
  problemType,
  type DraftItem,
  type Predicate,
  type QuestionInput,
} from "@qp/shared";
import { Value } from "typebox/value";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { publishDraft } from "../../../../src/db/definition/publish.js";
import { createNextDraft, replaceDraft } from "../../../../src/db/definition/drafts.js";
import { appendQuestionVersion, createQuestion } from "../../../../src/db/definition/questions.js";
import { AUTHOR_PLACEHOLDER } from "../../../../src/modules/definition/author.js";
import { aDraftWithOneItem, aPublishedQuestionnaire, aTextQuestion, type DraftFixture } from "../../../db/fixtures.js";
import { useTestDatabase } from "../../../db/harness.js";
import { definitionUrl, useDefinitionApp } from "../harness.js";

const testDatabase = useTestDatabase();
const app = useDefinitionApp(testDatabase);

const actor = { createdBy: "test", traceId: null };

const yesNo: QuestionInput = {
  type: "single_choice",
  prompt: "Do you have a medical condition?",
  options: [
    { optionId: "yes", label: "Yes" },
    { optionId: "no", label: "No" },
  ],
};

function draftUrl(questionnaireId: string, suffix = ""): string {
  return definitionUrl(`/questionnaires/${questionnaireId}/draft${suffix}`);
}

function placement(itemId: string, questionId: string, questionVersion = 1, visibleWhen: Predicate | null = null): DraftItem {
  return { itemId, required: true, visibleWhen, questionId, questionVersion };
}

function getDraft(questionnaireId: string) {
  return app().inject({ method: "GET", url: draftUrl(questionnaireId) });
}

function putDraft(questionnaireId: string, ifMatch: string | undefined, items: readonly DraftItem[], title = "Fixture") {
  return app().inject({
    method: "PUT",
    url: draftUrl(questionnaireId),
    headers: ifMatch === undefined ? {} : { "if-match": ifMatch },
    payload: { title, items },
  });
}

function openDraft(questionnaireId: string) {
  return app().inject({ method: "POST", url: draftUrl(questionnaireId) });
}

function validate(questionnaireId: string) {
  return app().inject({ method: "POST", url: draftUrl(questionnaireId, "/validate") });
}

function saved(outcome: Awaited<ReturnType<typeof replaceDraft>>) {
  if (outcome.outcome !== "saved") {
    throw new Error(`draft was not saved: ${outcome.outcome}`);
  }
  return outcome;
}

function published(outcome: Awaited<ReturnType<typeof publishDraft>>) {
  if (outcome.outcome !== "published") {
    throw new Error(`draft was not published: ${outcome.outcome}`);
  }
  return outcome;
}

async function archive(questionId: string): Promise<void> {
  const client = await testDatabase.connect("definition");
  await client.query("UPDATE definition.question SET archived_at = now() WHERE id = $1", [questionId]);
}

async function draftRowCount(questionnaireId: string): Promise<number> {
  const client = await testDatabase.connect("definition");
  const rows = await client.query(
    "SELECT 1 FROM definition.questionnaire_version WHERE questionnaire_id = $1 AND status = 'draft'",
    [questionnaireId],
  );
  return rows.rowCount ?? 0;
}

async function aDraftWithAForwardReference(): Promise<DraftFixture & { readonly items: DraftItem[] }> {
  const db = testDatabase.database("definition");
  const draft = await aDraftWithOneItem(db);
  const first = await createQuestion(db, { key: null, content: yesNo, ...actor });
  const second = await createQuestion(db, { key: null, content: yesNo, ...actor });
  const items = [
    placement("itm_01", first.questionId, 1, { all: [{ type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" }] }),
    placement("itm_02", second.questionId),
  ];
  const edited = saved(
    await replaceDraft(db, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      title: "Fixture",
      items,
      actorId: "test",
      traceId: null,
    }),
  );
  return { ...draft, draftRevision: edited.draftRevision, items };
}

describe("the draft lifecycle's author", () => {
  it("records prototype-author as the actor of create, save and open-next-draft", async () => {
    const db = testDatabase.database("definition");
    const question = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const created = await app().inject({
      method: "POST",
      url: definitionUrl("/questionnaires"),
      payload: { name: "Audited", title: "Audited" },
    });
    const { questionnaireId } = created.json();
    const opened = await getDraft(questionnaireId);
    const put = await putDraft(questionnaireId, opened.headers.etag as string, [placement("itm_01", question.questionId)]);
    const edited = put.json();
    const savedPrecondition = parseDraftEtag(put.headers.etag as string);
    published(
      await publishDraft(db, {
        questionnaireId,
        precondition: { versionId: savedPrecondition?.versionId ?? "", draftRevision: savedPrecondition?.draftRevision ?? -1 },
        actorId: "test",
        traceId: null,
      }),
    );
    const next = await openDraft(questionnaireId);

    expect(put.statusCode).toBe(200);
    expect(next.statusCode).toBe(201);
    const events = (await testDatabase.readAuditEvents()).filter((event) => event.questionnaire_id === questionnaireId);
    expect(events.map((event) => [event.action, event.actor_id])).toEqual([
      ["create_draft", AUTHOR_PLACEHOLDER],
      ["edit_draft", AUTHOR_PLACEHOLDER],
      ["publish", "test"],
      ["create_draft", AUTHOR_PLACEHOLDER],
    ]);
    const client = await testDatabase.connect("definition");
    const versions = await client.query(
      "SELECT id, created_by FROM definition.questionnaire_version WHERE questionnaire_id = $1 ORDER BY id",
      [questionnaireId],
    );
    expect(versions.rows).toEqual([
      { id: edited.versionId, created_by: AUTHOR_PLACEHOLDER },
      { id: next.json().versionId, created_by: AUTHOR_PLACEHOLDER },
    ]);
  });
});

describe("GET /questionnaires/:id/draft", () => {
  it("returns items in position order and each pinned question version once", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const choice = await createQuestion(db, { key: null, content: yesNo, ...actor });
    await appendQuestionVersion(db, {
      questionId: choice.questionId,
      content: { ...yesNo, options: [{ optionId: "no", label: "No" }, { optionId: "yes", label: "Yes" }] },
      ...actor,
    });
    const text = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const edited = saved(
      await replaceDraft(db, {
        questionnaireId: draft.questionnaireId,
        precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
        title: "Ordered",
        items: [
          placement("itm_c", text.questionId),
          placement("itm_a", choice.questionId, 2),
          placement("itm_b", choice.questionId, 2),
        ],
        actorId: "test",
        traceId: null,
      }),
    );

    const response = await getDraft(draft.questionnaireId);

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe(formatDraftEtag(draft.draftVersionId, edited.draftRevision));
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(Value.Check(QuestionnaireDraft, body)).toBe(true);
    expect(body.items.map((item: DraftItem) => item.itemId)).toEqual(["itm_c", "itm_a", "itm_b"]);
    expect(body.questions).toEqual([
      expect.objectContaining({ questionId: text.questionId, questionVersion: 1, type: "text", createdBy: "test" }),
      expect.objectContaining({
        questionId: choice.questionId,
        questionVersion: 2,
        options: [
          { optionId: "no", label: "No" },
          { optionId: "yes", label: "Yes" },
        ],
      }),
    ]);
  });

  it("is 404 for an unknown questionnaire and for one with no open draft", async () => {
    const publishedOnly = await aPublishedQuestionnaire(testDatabase.database("definition"));

    const unknown = await getDraft(uuidv7());
    const noDraft = await getDraft(publishedOnly.questionnaireId);

    for (const response of [unknown, noDraft]) {
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
      expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
    }
  });
});

describe("PUT /questionnaires/:id/draft", () => {
  it("replaces the draft and responds with it and the next ETag", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const second = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const read = await getDraft(draft.questionnaireId);

    const response = await putDraft(
      draft.questionnaireId,
      read.headers.etag as string,
      [placement("itm_02", second.questionId), placement("itm_01", draft.questionId)],
      "Renamed",
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe(formatDraftEtag(draft.draftVersionId, draft.draftRevision + 1));
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(Value.Check(QuestionnaireDraft, body)).toBe(true);
    expect(body).toMatchObject({ versionId: draft.draftVersionId, title: "Renamed" });
    expect(body.items.map((item: DraftItem) => item.itemId)).toEqual(["itm_02", "itm_01"]);
    const reread = await getDraft(draft.questionnaireId);
    expect(reread.json()).toEqual(body);
    expect(reread.headers.etag).toBe(response.headers.etag);
  });

  it("refuses the second of two tabs saving from the same read with 409 draft-stale", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const tabOne = await getDraft(draft.questionnaireId);
    const tabTwo = await getDraft(draft.questionnaireId);
    expect(tabOne.headers.etag).toBe(tabTwo.headers.etag);

    const first = await putDraft(draft.questionnaireId, tabOne.headers.etag as string, [], "Tab one");
    const second = await putDraft(draft.questionnaireId, tabTwo.headers.etag as string, [], "Tab two");

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(second.json()).toMatchObject({ type: problemType("questionnaire/draft-stale") });
    expect((await getDraft(draft.questionnaireId)).json().title).toBe("Tab one");
  });

  it("refuses an ETag from the previous draft even when the new draft has reached the same revision", async () => {
    const db = testDatabase.database("definition");
    const previous = await aPublishedQuestionnaire(db);
    const opened = await createNextDraft(db, { questionnaireId: previous.questionnaireId, ...actor });
    if (opened.outcome !== "created") {
      throw new Error(opened.outcome);
    }
    const next = saved(
      await replaceDraft(db, {
        questionnaireId: previous.questionnaireId,
        precondition: { versionId: opened.draft.versionId, draftRevision: opened.draftRevision },
        title: "Fixture",
        items: [],
        actorId: "test",
        traceId: null,
      }),
    );
    expect(next.draftRevision).toBe(previous.draftRevision);
    expect(next.draftVersionId).not.toBe(previous.draftVersionId);

    const response = await putDraft(
      previous.questionnaireId,
      formatDraftEtag(previous.draftVersionId, previous.draftRevision),
      [placement("itm_01", previous.questionId)],
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ type: problemType("questionnaire/draft-stale") });
    expect((await getDraft(previous.questionnaireId)).json().items).toEqual([]);
  });

  it.each([
    ["missing", undefined, "schema/required"],
    ["malformed", "W/\"not-a-draft-etag\"", "schema/pattern"],
  ])("is 400 when If-Match is %s, and writes nothing", async (_label, ifMatch, code) => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const eventsBefore = await testDatabase.readAuditEvents();

    const response = await putDraft(draft.questionnaireId, ifMatch, []);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      type: problemType("request/invalid"),
      errors: [{ pointer: "/headers/if-match", code }],
    });
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
    expect((await getDraft(draft.questionnaireId)).json().items).toHaveLength(1);
  });

  it("is 422 draft-invalid naming the items that place an archived question or a question version that does not exist, and leaves the draft untouched", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const archived = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    await archive(archived.questionId);
    const before = await getDraft(draft.questionnaireId);
    const eventsBefore = await testDatabase.readAuditEvents();
    const etag = before.headers.etag as string;

    const archivedResponse = await putDraft(draft.questionnaireId, etag, [
      placement("itm_01", draft.questionId),
      placement("itm_02", archived.questionId),
    ]);
    const unknownResponse = await putDraft(draft.questionnaireId, etag, [
      placement("itm_01", draft.questionId, 9),
      placement("itm_02", draft.questionId),
      placement("itm_03", uuidv7()),
    ]);

    expect(archivedResponse.statusCode).toBe(422);
    expect(archivedResponse.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(archivedResponse.json()).toMatchObject({
      type: problemType("questionnaire/draft-invalid"),
      items: [{ itemId: "itm_02", code: "draft/question-archived" }],
    });
    expect(unknownResponse.statusCode).toBe(422);
    expect(unknownResponse.json()).toMatchObject({
      type: problemType("questionnaire/draft-invalid"),
      items: [
        { itemId: "itm_01", code: "draft/question-version-unknown" },
        { itemId: "itm_03", code: "draft/question-version-unknown" },
      ],
    });
    const after = await getDraft(draft.questionnaireId);
    expect(after.headers.etag).toBe(etag);
    expect(after.json()).toEqual(before.json());
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
  });

  it("is 200 for a save keeping an item whose question was archived after placement, and 422 naming only a newly added one", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const second = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const added = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const withTwo = await putDraft(draft.questionnaireId, (await getDraft(draft.questionnaireId)).headers.etag as string, [
      placement("itm_01", draft.questionId),
      placement("itm_02", second.questionId),
    ]);
    await archive(draft.questionId);
    await archive(added.questionId);

    const reordered = await putDraft(
      draft.questionnaireId,
      withTwo.headers.etag as string,
      [placement("itm_02", second.questionId), placement("itm_01", draft.questionId)],
      "Reordered",
    );
    const eventsBefore = await testDatabase.readAuditEvents();
    const withAdded = await putDraft(draft.questionnaireId, reordered.headers.etag as string, [
      placement("itm_02", second.questionId),
      placement("itm_01", draft.questionId),
      placement("itm_03", added.questionId),
    ]);

    expect(reordered.statusCode).toBe(200);
    expect(reordered.json()).toMatchObject({
      title: "Reordered",
      items: [placement("itm_02", second.questionId), placement("itm_01", draft.questionId)],
    });
    expect(withAdded.statusCode).toBe(422);
    expect(withAdded.json()).toMatchObject({
      type: problemType("questionnaire/draft-invalid"),
      items: [{ itemId: "itm_03", code: "draft/question-archived" }],
    });
    expect((await getDraft(draft.questionnaireId)).headers.etag).toBe(reordered.headers.etag);
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
  });

  it("is 422 draft-invalid naming each duplicated item id once, before the database sees the insert, and leaves the draft untouched", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const second = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const third = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    const before = await getDraft(draft.questionnaireId);
    const eventsBefore = await testDatabase.readAuditEvents();
    const etag = before.headers.etag as string;

    const response = await putDraft(draft.questionnaireId, etag, [
      placement("itm_02", second.questionId),
      placement("itm_01", draft.questionId),
      placement("itm_02", third.questionId),
      placement("itm_03", third.questionId),
      placement("itm_01", second.questionId),
      placement("itm_02", draft.questionId),
    ]);

    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(response.json()).toMatchObject({
      type: problemType("questionnaire/draft-invalid"),
      items: [
        { itemId: "itm_02", code: "draft/duplicate-item-id" },
        { itemId: "itm_01", code: "draft/duplicate-item-id" },
      ],
    });
    const after = await getDraft(draft.questionnaireId);
    expect(after.headers.etag).toBe(etag);
    expect(after.json()).toEqual(before.json());
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
  });

  it("answers a stale ETag with 409 draft-stale even when the items would also be refused as archived or duplicated", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithOneItem(db);
    const archived = await createQuestion(db, { key: null, content: aTextQuestion, ...actor });
    await archive(archived.questionId);
    const stale = (await getDraft(draft.questionnaireId)).headers.etag as string;
    const current = await putDraft(draft.questionnaireId, stale, [placement("itm_01", draft.questionId)], "Moved on");
    expect(current.statusCode).toBe(200);
    const eventsBefore = await testDatabase.readAuditEvents();

    const staleWithArchived = await putDraft(draft.questionnaireId, stale, [
      placement("itm_01", draft.questionId),
      placement("itm_02", archived.questionId),
    ]);
    const staleWithDuplicates = await putDraft(draft.questionnaireId, stale, [
      placement("itm_01", draft.questionId),
      placement("itm_01", draft.questionId),
    ]);

    for (const response of [staleWithArchived, staleWithDuplicates]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ type: problemType("questionnaire/draft-stale") });
    }
    const after = await getDraft(draft.questionnaireId);
    expect(after.headers.etag).toBe(current.headers.etag);
    expect(after.json().title).toBe("Moved on");
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
  });

  it("is 404 when the questionnaire has no open draft", async () => {
    const publishedOnly = await aPublishedQuestionnaire(testDatabase.database("definition"));

    const response = await putDraft(
      publishedOnly.questionnaireId,
      formatDraftEtag(publishedOnly.draftVersionId, publishedOnly.draftRevision),
      [],
    );

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ type: problemType("resource/not-found") });
  });
});

describe("POST /questionnaires/:id/draft", () => {
  it("opens the next draft as a copy of the latest published version, pinning the same question versions", async () => {
    const db = testDatabase.database("definition");
    const v1 = await aPublishedQuestionnaire(db);
    await appendQuestionVersion(db, { questionId: v1.questionId, content: { ...aTextQuestion, prompt: "Anything more?" }, ...actor });
    const choice = await createQuestion(db, { key: null, content: yesNo, ...actor });
    const second = await createNextDraft(db, { questionnaireId: v1.questionnaireId, ...actor });
    if (second.outcome !== "created") {
      throw new Error(second.outcome);
    }
    const sourceItems = [
      placement("itm_02", choice.questionId),
      placement("itm_01", v1.questionId, 2, { all: [{ type: "single_choice", itemId: "itm_02", op: "is", optionId: "yes" }] }),
    ];
    const v2Draft = saved(
      await replaceDraft(db, {
        questionnaireId: v1.questionnaireId,
        precondition: { versionId: second.draft.versionId, draftRevision: second.draftRevision },
        title: "Second edition",
        items: sourceItems,
        actorId: "test",
        traceId: null,
      }),
    );
    published(
      await publishDraft(db, {
        questionnaireId: v1.questionnaireId,
        precondition: { versionId: v2Draft.draftVersionId, draftRevision: v2Draft.draftRevision },
        actorId: "test",
        traceId: null,
      }),
    );
    await appendQuestionVersion(db, { questionId: v1.questionId, content: { ...aTextQuestion, prompt: "Third wording" }, ...actor });

    const response = await openDraft(v1.questionnaireId);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(Value.Check(QuestionnaireDraft, body)).toBe(true);
    expect(body.versionId).not.toBe(v2Draft.draftVersionId);
    expect(body).toMatchObject({ questionnaireId: v1.questionnaireId, title: "Second edition", items: sourceItems });
    expect(body.questions.map((q: { questionId: string; questionVersion: number }) => [q.questionId, q.questionVersion])).toEqual([
      [choice.questionId, 1],
      [v1.questionId, 2],
    ]);
    expect(response.headers.etag).toBe(formatDraftEtag(body.versionId, 0));
    expect(response.headers["cache-control"]).toBe("no-store");
    const events = await testDatabase.readAuditEvents();
    expect(events.at(-1)).toMatchObject({
      action: "create_draft",
      questionnaire_id: v1.questionnaireId,
      questionnaire_version_id: body.versionId,
      actor_id: AUTHOR_PLACEHOLDER,
      summary: { copiedFromVersion: 2 },
    });
  });

  it("lets exactly one of two concurrent opens create the draft; the other is 409 draft-exists", async () => {
    const publishedOnly = await aPublishedQuestionnaire(testDatabase.database("definition"));

    const responses = await Promise.all([openDraft(publishedOnly.questionnaireId), openDraft(publishedOnly.questionnaireId)]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.statusCode === 409);
    expect(refused?.json()).toMatchObject({ type: problemType("questionnaire/draft-exists") });
    expect(await draftRowCount(publishedOnly.questionnaireId)).toBe(1);
    const opens = (await testDatabase.readAuditEvents()).filter(
      (event) => event.action === "create_draft" && event.actor_id === AUTHOR_PLACEHOLDER,
    );
    expect(opens).toHaveLength(1);
  });

  it("is 409 draft-exists while a draft is open, and 404 for an unknown questionnaire", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));

    const exists = await openDraft(draft.questionnaireId);
    const unknown = await openDraft(uuidv7());

    expect(exists.statusCode).toBe(409);
    expect(exists.json()).toMatchObject({ type: problemType("questionnaire/draft-exists") });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ type: problemType("resource/not-found") });
  });

  it("keeps a copied item whose question has since been archived; the draft validates, saves and publishes", async () => {
    const db = testDatabase.database("definition");
    const publishedOnly = await aPublishedQuestionnaire(db);
    await archive(publishedOnly.questionId);

    const response = await openDraft(publishedOnly.questionnaireId);
    const validation = await validate(publishedOnly.questionnaireId);
    const save = await putDraft(publishedOnly.questionnaireId, response.headers.etag as string, response.json().items, "Second edition");
    const saveEtag = parseDraftEtag(save.headers.etag as string);
    if (saveEtag === undefined) {
      throw new Error("the saved draft carried no ETag");
    }
    const publish = await publishDraft(db, {
      questionnaireId: publishedOnly.questionnaireId,
      precondition: saveEtag,
      actorId: "test",
      traceId: null,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().items).toEqual([placement("itm_01", publishedOnly.questionId)]);
    expect(validation.json()).toEqual({ valid: true, items: [] });
    expect(save.statusCode).toBe(200);
    expect(publish).toMatchObject({ outcome: "published", version: 2 });
  });
});

describe("POST /questionnaires/:id/draft/validate", () => {
  it("reports what publish would refuse, and writes nothing", async () => {
    const db = testDatabase.database("definition");
    const draft = await aDraftWithAForwardReference();
    const eventsBefore = await testDatabase.readAuditEvents();
    const before = await getDraft(draft.questionnaireId);

    const response = await validate(draft.questionnaireId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ valid: false, items: [{ itemId: "itm_01", code: "predicate/forward-reference" }] });
    expect(await testDatabase.readAuditEvents()).toEqual(eventsBefore);
    expect((await getDraft(draft.questionnaireId)).headers.etag).toBe(before.headers.etag);
    const publish = await publishDraft(db, {
      questionnaireId: draft.questionnaireId,
      precondition: { versionId: draft.draftVersionId, draftRevision: draft.draftRevision },
      actorId: "test",
      traceId: null,
    });
    expect(publish).toEqual({ outcome: "invalid", items: response.json().items });
  });

  it("does not report an item whose question was archived after it was placed", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));
    await archive(draft.questionId);

    const response = await validate(draft.questionnaireId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ valid: true, items: [] });
  });

  it("reports a publishable draft as valid", async () => {
    const draft = await aDraftWithOneItem(testDatabase.database("definition"));

    const response = await validate(draft.questionnaireId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ valid: true, items: [] });
  });

  it("is 404 when there is no open draft", async () => {
    const publishedOnly = await aPublishedQuestionnaire(testDatabase.database("definition"));

    const noDraft = await validate(publishedOnly.questionnaireId);
    const unknown = await validate(uuidv7());

    expect(noDraft.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(noDraft.json()).toMatchObject({ type: problemType("resource/not-found") });
  });
});
