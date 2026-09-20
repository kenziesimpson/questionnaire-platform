import {
  PROBLEM_CONTENT_TYPE,
  definitionApi,
  isDraftEtagFor,
  reportingApi,
  routePath,
  routeSearch,
  successSchemaOf,
  type PathParams,
  type QueryParams,
  type QuestionnaireDraft,
  type RequestParts as RouteRequestParts,
  type RouteDefinition,
  type RouteWith,
  type SuccessBody,
  type VersionSummary,
} from "@qp/shared";
import { injectTraceHeaders } from "@qp/telemetry/browser";
import { Value } from "typebox/value";
import type { DraftContent, VersionedDraft } from "./draft-types";
import { UnexpectedResponseError, problemErrorFrom } from "./problem-error";

type DefinitionRoute = (typeof definitionApi.definitionRoutes)[number];

type DraftEtagRoute =
  | typeof definitionApi.getDraft
  | typeof definitionApi.openDraft
  | typeof definitionApi.replaceDraft
  | typeof definitionApi.publishDraft;

type PlainDefinitionRoute = Exclude<DefinitionRoute, DraftEtagRoute>;

type RequestParts<R extends RouteDefinition> = RouteRequestParts<R> & { signal?: AbortSignal };

interface LooseParts {
  params?: PathParams;
  query?: QueryParams;
  body?: unknown;
  ifMatch?: string;
  signal?: AbortSignal;
}

interface Exchange<Body> {
  status: number;
  body: Body;
  headers: Headers;
}

function definitionUrl(route: RouteDefinition, parts: Pick<LooseParts, "params" | "query"> = {}): string {
  return `${definitionApi.DEFINITION_PREFIX}${routePath(route.url, parts.params)}${routeSearch(parts.query)}`;
}

export function reportingUrl(route: RouteDefinition, parts: Pick<LooseParts, "params" | "query"> = {}): string {
  return `${reportingApi.REPORTING_PREFIX}${routePath(route.url, parts.params)}${routeSearch(parts.query)}`;
}

async function jsonOf(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new UnexpectedResponseError(response.status, "the body is not JSON");
  }
}

interface ApiSide {
  readonly urlOf: typeof definitionUrl;
}

const DEFINITION_SIDE: ApiSide = { urlOf: definitionUrl };

const REPORTING_SIDE: ApiSide = { urlOf: reportingUrl };

function requestHeaders(parts: LooseParts): Record<string, string> {
  const headers: Record<string, string> = { accept: `application/json, ${PROBLEM_CONTENT_TYPE}` };
  if (parts.body !== undefined) headers["content-type"] = "application/json";
  if (parts.ifMatch !== undefined) headers["if-match"] = parts.ifMatch;
  return headers;
}

async function checkedExchangeAt({ urlOf }: ApiSide, route: RouteDefinition, parts: LooseParts): Promise<Exchange<unknown>> {
  const headers = injectTraceHeaders(requestHeaders(parts));
  const response = await fetch(urlOf(route, parts), {
    method: route.method,
    headers,
    body: parts.body === undefined ? undefined : JSON.stringify(parts.body),
    signal: parts.signal,
  });
  const body = await jsonOf(response);

  if (!response.ok) {
    throw problemErrorFrom(response.status, body) ?? new UnexpectedResponseError(response.status, "not a problem+json body");
  }
  const schema = successSchemaOf(route, response.status);
  if (schema === undefined) {
    throw new UnexpectedResponseError(response.status, `${route.method} ${route.url} does not declare this status`);
  }
  if (!Value.Check(schema, body)) {
    throw new UnexpectedResponseError(response.status, `the body does not match ${route.method} ${route.url}`);
  }
  return { status: response.status, body, headers: response.headers };
}

function checkedExchange(route: RouteDefinition, parts: LooseParts): Promise<Exchange<unknown>> {
  return checkedExchangeAt(DEFINITION_SIDE, route, parts);
}

function exchange<R extends RouteWith<200>>(route: R, parts: RequestParts<R>): Promise<Exchange<SuccessBody<R, 200>>>;
function exchange<R extends RouteWith<201>>(route: R, parts: RequestParts<R>): Promise<Exchange<SuccessBody<R, 201>>>;
function exchange(route: RouteDefinition, parts: LooseParts): Promise<Exchange<unknown>> {
  return checkedExchange(route, parts);
}

export function callDefinition<R extends PlainDefinitionRoute & RouteWith<200>>(
  route: R,
  parts: RequestParts<R>,
): Promise<SuccessBody<R, 200>>;
export function callDefinition<R extends PlainDefinitionRoute & RouteWith<201>>(
  route: R,
  parts: RequestParts<R>,
): Promise<SuccessBody<R, 201>>;
export async function callDefinition(route: RouteDefinition, parts: LooseParts): Promise<unknown> {
  return (await checkedExchange(route, parts)).body;
}

export async function callReporting<R extends RouteWith<200>>(route: R, parts: RequestParts<R>): Promise<SuccessBody<R, 200>> {
  return ((await checkedExchangeAt(REPORTING_SIDE, route, parts)) as Exchange<SuccessBody<R, 200>>).body;
}

function versionedDraft({ status, body, headers }: Exchange<QuestionnaireDraft>): VersionedDraft {
  const etag = headers.get("etag");
  if (etag === null || !isDraftEtagFor(etag, body.versionId)) {
    throw new UnexpectedResponseError(status, "a draft response must carry that draft's ETag");
  }
  return { draft: body, etag };
}

export const draftApi = {
  async get(questionnaireId: string, signal?: AbortSignal): Promise<VersionedDraft> {
    return versionedDraft(await exchange(definitionApi.getDraft, { params: { id: questionnaireId }, signal }));
  },
  async open(questionnaireId: string): Promise<VersionedDraft> {
    return versionedDraft(await exchange(definitionApi.openDraft, { params: { id: questionnaireId } }));
  },
  async replace(questionnaireId: string, content: DraftContent, ifMatch: string): Promise<VersionedDraft> {
    return versionedDraft(
      await exchange(definitionApi.replaceDraft, { params: { id: questionnaireId }, body: content, ifMatch }),
    );
  },
  async publish(questionnaireId: string, ifMatch: string): Promise<VersionSummary> {
    return (await exchange(definitionApi.publishDraft, { params: { id: questionnaireId }, ifMatch })).body;
  },
};
