import type { APIRequestContext } from "@playwright/test";
import {
  definitionApi,
  parseDraftEtag,
  type BodyOf,
  type DraftItem,
  type Predicate,
  type PublishedDefinition,
  type Question,
  type QuestionInput,
  type QuestionnaireDraft,
  type QuestionnaireSummary,
  type QuestionUsage,
  type QuestionVersion,
  type QuestionVersionSummary,
  type ReplyOf,
  type RouteDefinition,
  type VersionSummary,
} from "@qp/shared";
import { expectBody, sendRouteRequest, type ApiExchange, type ApiRequestParts } from "./api-exchange";

export type DraftContent = BodyOf<typeof definitionApi.replaceDraft>;
export type DraftValidationResult = ReplyOf<typeof definitionApi.validateDraft, 200>;

export interface VersionedDraft {
  readonly draft: QuestionnaireDraft;
  readonly etag: string;
}

export type NewQuestionnaire = BodyOf<typeof definitionApi.createQuestionnaire>;

export interface Placement {
  readonly itemId: string;
  readonly question: Question | QuestionVersion;
  readonly required?: boolean;
  readonly visibleWhen?: Predicate | null;
}

export interface PublishedQuestionnaire {
  readonly questionnaire: QuestionnaireSummary;
  readonly version: VersionSummary;
  readonly definition: PublishedDefinition;
}

function pinOf(question: Question | QuestionVersion): { questionId: string; questionVersion: number } {
  return "latest" in question
    ? { questionId: question.questionId, questionVersion: question.latest.questionVersion }
    : { questionId: question.questionId, questionVersion: question.questionVersion };
}

export function draftItem({ itemId, question, required = true, visibleWhen = null }: Placement): DraftItem {
  return { itemId, required, visibleWhen, ...pinOf(question) };
}

export function uniqueName(label: string): string {
  return `${label} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class DefinitionApi {
  readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  send(route: RouteDefinition, parts: ApiRequestParts = {}): Promise<ApiExchange> {
    return sendRouteRequest(this.request, definitionApi.DEFINITION_PREFIX, route, parts);
  }

  async listQuestions(options: { includeArchived?: boolean } = {}): Promise<Question[]> {
    const route = definitionApi.listQuestions;
    return expectBody(await this.send(route, { query: options }), 200, route.schema.response[200]);
  }

  async createQuestion(question: QuestionInput, key?: string): Promise<Question> {
    const route = definitionApi.createQuestion;
    const body: BodyOf<typeof route> = key === undefined ? { question } : { key, question };
    return expectBody(await this.send(route, { body }), 201, route.schema.response[201]);
  }

  async getQuestion(questionId: string): Promise<Question> {
    const route = definitionApi.getQuestion;
    return expectBody(await this.send(route, { params: { questionId } }), 200, route.schema.response[200]);
  }

  async listQuestionVersions(questionId: string): Promise<QuestionVersionSummary[]> {
    const route = definitionApi.listQuestionVersions;
    return expectBody(await this.send(route, { params: { questionId } }), 200, route.schema.response[200]);
  }

  async getQuestionVersion(questionId: string, version: number): Promise<QuestionVersion> {
    const route = definitionApi.getQuestionVersion;
    return expectBody(await this.send(route, { params: { questionId, v: version } }), 200, route.schema.response[200]);
  }

  async createQuestionVersion(questionId: string, question: QuestionInput): Promise<QuestionVersion> {
    const route = definitionApi.createQuestionVersion;
    return expectBody(await this.send(route, { params: { questionId }, body: { question } }), 201, route.schema.response[201]);
  }

  async archiveQuestion(questionId: string): Promise<Question> {
    const route = definitionApi.archiveQuestion;
    return expectBody(await this.send(route, { params: { questionId } }), 200, route.schema.response[200]);
  }

  async getQuestionUsage(questionId: string): Promise<QuestionUsage[]> {
    const route = definitionApi.getQuestionUsage;
    return expectBody(await this.send(route, { params: { questionId } }), 200, route.schema.response[200]);
  }

  async listQuestionnaires(): Promise<QuestionnaireSummary[]> {
    const route = definitionApi.listQuestionnaires;
    return expectBody(await this.send(route), 200, route.schema.response[200]);
  }

  async createQuestionnaire(questionnaire: NewQuestionnaire): Promise<QuestionnaireSummary> {
    const route = definitionApi.createQuestionnaire;
    return expectBody(await this.send(route, { body: questionnaire }), 201, route.schema.response[201]);
  }

  async getDraft(questionnaireId: string): Promise<VersionedDraft> {
    const route = definitionApi.getDraft;
    const exchange = await this.send(route, { params: { id: questionnaireId } });
    return versionedDraft(exchange, expectBody(exchange, 200, route.schema.response[200]));
  }

  async openDraft(questionnaireId: string): Promise<VersionedDraft> {
    const route = definitionApi.openDraft;
    const exchange = await this.send(route, { params: { id: questionnaireId } });
    return versionedDraft(exchange, expectBody(exchange, 201, route.schema.response[201]));
  }

  async replaceDraft(questionnaireId: string, content: DraftContent, ifMatch: string): Promise<VersionedDraft> {
    const route = definitionApi.replaceDraft;
    const exchange = await this.send(route, { params: { id: questionnaireId }, body: content, ifMatch });
    return versionedDraft(exchange, expectBody(exchange, 200, route.schema.response[200]));
  }

  async validateDraft(questionnaireId: string): Promise<DraftValidationResult> {
    const route = definitionApi.validateDraft;
    return expectBody(await this.send(route, { params: { id: questionnaireId } }), 200, route.schema.response[200]);
  }

  async publishDraft(questionnaireId: string, ifMatch: string): Promise<VersionSummary> {
    const route = definitionApi.publishDraft;
    return expectBody(await this.send(route, { params: { id: questionnaireId }, ifMatch }), 201, route.schema.response[201]);
  }

  async listVersions(questionnaireId: string): Promise<VersionSummary[]> {
    const route = definitionApi.listVersions;
    return expectBody(await this.send(route, { params: { id: questionnaireId } }), 200, route.schema.response[200]);
  }

  async getVersion(questionnaireId: string, version: number): Promise<PublishedDefinition> {
    const route = definitionApi.getVersion;
    return expectBody(await this.send(route, { params: { id: questionnaireId, v: version } }), 200, route.schema.response[200]);
  }

  async setClosesAt(questionnaireId: string, closesAt: Date | null): Promise<QuestionnaireSummary> {
    const route = definitionApi.setClosesAt;
    const body: BodyOf<typeof route> = { closesAt: closesAt === null ? null : closesAt.toISOString() };
    return expectBody(await this.send(route, { params: { id: questionnaireId }, body }), 200, route.schema.response[200]);
  }

  async placeItems(questionnaireId: string, placements: readonly Placement[], title?: string): Promise<VersionedDraft> {
    const { draft, etag } = await this.getDraft(questionnaireId);
    return this.replaceDraft(questionnaireId, { title: title ?? draft.title, items: placements.map(draftItem) }, etag);
  }

  async publishCurrentDraft(questionnaireId: string): Promise<PublishedQuestionnaire> {
    const { etag } = await this.getDraft(questionnaireId);
    const version = await this.publishDraft(questionnaireId, etag);
    return this.publishedQuestionnaire(questionnaireId, version);
  }

  async createPublishedQuestionnaire(questionnaire: NewQuestionnaire, placements: readonly Placement[]): Promise<PublishedQuestionnaire> {
    const created = await this.createQuestionnaire(questionnaire);
    const { etag } = await this.placeItems(created.questionnaireId, placements);
    const version = await this.publishDraft(created.questionnaireId, etag);
    return this.publishedQuestionnaire(created.questionnaireId, version);
  }

  async publishNextVersion(questionnaireId: string, placements: readonly Placement[], title?: string): Promise<PublishedQuestionnaire> {
    await this.openDraft(questionnaireId);
    const { etag } = await this.placeItems(questionnaireId, placements, title);
    const version = await this.publishDraft(questionnaireId, etag);
    return this.publishedQuestionnaire(questionnaireId, version);
  }

  async questionnaireSummary(questionnaireId: string): Promise<QuestionnaireSummary> {
    const summary = (await this.listQuestionnaires()).find((candidate) => candidate.questionnaireId === questionnaireId);
    if (summary === undefined) throw new Error(`Questionnaire ${questionnaireId} is not in GET /questionnaires`);
    return summary;
  }

  private async publishedQuestionnaire(questionnaireId: string, version: VersionSummary): Promise<PublishedQuestionnaire> {
    const [questionnaire, definition] = await Promise.all([
      this.questionnaireSummary(questionnaireId),
      this.getVersion(questionnaireId, version.version),
    ]);
    return { questionnaire, version, definition };
  }
}

function versionedDraft(exchange: ApiExchange, draft: QuestionnaireDraft): VersionedDraft {
  const etag = exchange.headers["etag"];
  if (etag === undefined || parseDraftEtag(etag)?.versionId !== draft.versionId.toLowerCase()) {
    throw new Error(`${exchange.method} ${exchange.path} answered a draft without that draft's ETag (got ${etag ?? "none"})`);
  }
  return { draft, etag };
}
