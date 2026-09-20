import {
  definitionApi,
  draftItemOf,
  formatDraftEtag,
  validateDraft,
  type DraftItem,
  type PublishedDefinition,
  type Question,
  type QuestionContent,
  type QuestionVersion,
  type QuestionnaireDraft,
  type QuestionnaireSummary,
  type RouteDefinition,
  type VersionSummary,
} from "@qp/shared";
import { contractResponse, jsonResponse, problemResponse, stubFetch, type RecordedRequest, type Reply } from "@qp/ui/testing";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { etagAt } from "./builders";

export function draftResponse(draft: QuestionnaireDraft, revision: number, status = 200): Response {
  return jsonResponse(status, draft, { etag: etagAt(revision) });
}

export type Routes = Record<string, Reply>;

export function routed(routes: Routes, unrouted: Reply): Reply {
  return (request) => (routes[`${request.method} ${request.url}`] ?? unrouted)(request);
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

interface StoredDraft {
  versionId: string;
  revision: number;
  title: string;
  items: DraftItem[];
  updatedAt: string;
}

interface StoredQuestionnaire {
  summary: QuestionnaireSummary;
  draft: StoredDraft | null;
  versions: { summary: VersionSummary; snapshot: PublishedDefinition }[];
}

type Handler = (request: RecordedRequest, ...captures: string[]) => Response;

const PREFIX = definitionApi.DEFINITION_PREFIX;

function contentOf({ createdAt: _createdAt, createdBy: _createdBy, ...content }: QuestionVersion): QuestionContent {
  return content;
}

function bodyOf<S extends TSchema>(request: RecordedRequest, schema: S): Static<S> {
  if (!Value.Check(schema, request.body)) throw new Error(`${request.method} ${request.url} sent a body the contract rejects`);
  return request.body;
}

export function fakeDefinitionApi({ bank = [] }: { bank?: Question[] } = {}) {
  let clock = Date.parse("2026-09-14T09:00:00.000Z");
  const now = () => new Date((clock += 60_000)).toISOString();
  const questions = new Map<string, QuestionVersion[]>(bank.map((question) => [question.questionId, [question.latest]]));
  const bankEntries = new Map<string, Question>(bank.map((question) => [question.questionId, question]));
  const questionnaires = new Map<string, StoredQuestionnaire>();

  const pinned = (items: readonly DraftItem[]) =>
    items.map(({ questionId, questionVersion }) => {
      const version = questions.get(questionId)?.find((candidate) => candidate.questionVersion === questionVersion);
      if (version === undefined) throw new Error(`the draft pins unknown question ${questionId} v${questionVersion}`);
      return version;
    });

  const draftBody = (questionnaireId: string, draft: StoredDraft): QuestionnaireDraft => ({
    questionnaireId,
    versionId: draft.versionId,
    title: draft.title,
    updatedAt: draft.updatedAt,
    items: draft.items,
    questions: [...new Map(pinned(draft.items).map((version) => [`${version.questionId}:${version.questionVersion}`, version])).values()],
  });

  const draftReply = (route: RouteDefinition, status: number, questionnaireId: string, draft: StoredDraft) =>
    contractResponse(route, status, draftBody(questionnaireId, draft), { etag: formatDraftEtag(draft.versionId, draft.revision) });

  const withQuestionnaire = (id: string, act: (stored: StoredQuestionnaire) => Response) => {
    const stored = questionnaires.get(id);
    return stored === undefined ? problemResponse("resource/not-found") : act(stored);
  };

  const withDraft = (id: string, act: (stored: StoredQuestionnaire, draft: StoredDraft) => Response) =>
    withQuestionnaire(id, (stored) => (stored.draft === null ? problemResponse("resource/not-found") : act(stored, stored.draft)));

  const matchesEtag = (request: RecordedRequest, draft: StoredDraft) =>
    request.headers.get("if-match") === formatDraftEtag(draft.versionId, draft.revision);

  const routes: [string, RegExp, Handler][] = [
    ["GET", /^\/questions\?includeArchived=(true|false)$/, (_, includeArchived) =>
      contractResponse(
        definitionApi.listQuestions,
        200,
        [...bankEntries.values()].filter((question) => includeArchived === "true" || question.archivedAt === null).reverse(),
      )],
    ["POST", /^\/questions$/, (request) => {
      const { question: input } = bodyOf(request, definitionApi.createQuestion.schema.body);
      const questionId = crypto.randomUUID();
      const createdAt = now();
      const latest: QuestionVersion = { ...input, questionId, questionVersion: 1, createdAt, createdBy: null };
      const entry: Question = { questionId, key: null, archivedAt: null, createdAt, latest };
      questions.set(questionId, [latest]);
      bankEntries.set(questionId, entry);
      return contractResponse(definitionApi.createQuestion, 201, entry);
    }],
    ["GET", /^\/questions\/([^/]+)\/usage$/, (_, questionId) =>
      contractResponse(
        definitionApi.getQuestionUsage,
        200,
        [...questionnaires.values()].flatMap(({ versions }) =>
          versions.flatMap(({ summary, snapshot }) =>
            snapshot.items
              .filter((item) => item.question.questionId === questionId)
              .map((item) => ({ questionnaireId: summary.questionnaireId, version: summary.version, questionVersion: item.question.questionVersion })),
          ),
        ),
      )],
    ["GET", /^\/questionnaires$/, () =>
      contractResponse(definitionApi.listQuestionnaires, 200, [...questionnaires.values()].map(({ summary }) => summary).reverse())],
    ["POST", /^\/questionnaires$/, (request) => {
      const { name, title } = bodyOf(request, definitionApi.createQuestionnaire.schema.body);
      const questionnaireId = crypto.randomUUID();
      const createdAt = now();
      const summary: QuestionnaireSummary = {
        questionnaireId,
        key: null,
        name,
        currentVersion: null,
        closesAt: null,
        hasDraft: true,
        createdAt,
        updatedAt: createdAt,
      };
      questionnaires.set(questionnaireId, {
        summary,
        draft: { versionId: crypto.randomUUID(), revision: 1, title, items: [], updatedAt: createdAt },
        versions: [],
      });
      return contractResponse(definitionApi.createQuestionnaire, 201, summary);
    }],
    ["GET", /^\/questionnaires\/([^/]+)\/draft$/, (_, id) =>
      withDraft(id, (_stored, draft) => draftReply(definitionApi.getDraft, 200, id, draft))],
    ["PUT", /^\/questionnaires\/([^/]+)\/draft$/, (request, id) =>
      withDraft(id, (stored, draft) => {
        if (!matchesEtag(request, draft)) return problemResponse("questionnaire/draft-stale");
        const { title, items } = bodyOf(request, definitionApi.replaceDraft.schema.body);
        const updatedAt = now();
        stored.draft = { ...draft, title, items, revision: draft.revision + 1, updatedAt };
        stored.summary = { ...stored.summary, updatedAt };
        return draftReply(definitionApi.replaceDraft, 200, id, stored.draft);
      })],
    ["POST", /^\/questionnaires\/([^/]+)\/draft\/validate$/, (_, id) =>
      withDraft(id, (_stored, draft) => {
        const { valid, items } = validateDraft({ items: draft.items, questions: pinned(draft.items).map(contentOf) });
        return contractResponse(definitionApi.validateDraft, 200, { valid, items: items.map(({ itemId, code }) => ({ itemId, code })) });
      })],
    ["POST", /^\/questionnaires\/([^/]+)\/draft$/, (_, id) =>
      withQuestionnaire(id, (stored) => {
        if (stored.draft !== null) return problemResponse("questionnaire/draft-exists");
        const latest = stored.versions.at(-1);
        if (latest === undefined) return problemResponse("resource/not-found");
        const updatedAt = now();
        stored.draft = {
          versionId: crypto.randomUUID(),
          revision: 1,
          title: latest.snapshot.title,
          items: latest.snapshot.items.map(draftItemOf),
          updatedAt,
        };
        stored.summary = { ...stored.summary, hasDraft: true, updatedAt };
        return draftReply(definitionApi.openDraft, 201, id, stored.draft);
      })],
    ["POST", /^\/questionnaires\/([^/]+)\/publish$/, (request, id) =>
      withDraft(id, (stored, draft) => {
        if (!matchesEtag(request, draft)) return problemResponse("questionnaire/draft-stale");
        const version = stored.versions.length + 1;
        const questionsByItem = pinned(draft.items);
        const snapshot: PublishedDefinition = {
          formatVersion: 1,
          questionnaireId: id,
          version,
          title: draft.title,
          items: draft.items.map(({ questionId: _questionId, questionVersion: _questionVersion, ...item }, index) => {
            const pinnedVersion = questionsByItem[index];
            if (pinnedVersion === undefined) throw new Error(`no pinned question version for item ${index}`);
            return { ...item, question: contentOf(pinnedVersion) };
          }),
        };
        const publishedAt = now();
        const summary: VersionSummary = {
          questionnaireId: id,
          version,
          publishedAt,
          publishedBy: null,
          itemCount: draft.items.length,
          formatVersion: 1,
        };
        stored.versions.push({ summary, snapshot });
        stored.draft = null;
        stored.summary = { ...stored.summary, currentVersion: version, hasDraft: false, updatedAt: publishedAt };
        return contractResponse(definitionApi.publishDraft, 201, summary);
      })],
    ["GET", /^\/questionnaires\/([^/]+)\/versions$/, (_, id) =>
      withQuestionnaire(id, ({ versions }) =>
        contractResponse(definitionApi.listVersions, 200, versions.map(({ summary }) => summary).reverse()),
      )],
    ["GET", /^\/questionnaires\/([^/]+)\/versions\/(\d+)$/, (_, id, version) =>
      withQuestionnaire(id, ({ versions }) => {
        const found = versions.find(({ summary }) => String(summary.version) === version);
        return found === undefined ? problemResponse("resource/not-found") : contractResponse(definitionApi.getVersion, 200, found.snapshot);
      })],
  ];

  const requests = stubFetch((request) => {
    const path = request.url.startsWith(PREFIX) ? request.url.slice(PREFIX.length) : request.url;
    for (const [method, pattern, handle] of routes) {
      const match = request.method === method ? pattern.exec(path) : null;
      if (match !== null) return handle(request, ...match.slice(1));
    }
    throw new Error(`the fake definition API has no route for ${request.method} ${request.url}`);
  });

  return { requests };
}
