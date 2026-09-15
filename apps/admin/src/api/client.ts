import {
  PROBLEM_CONTENT_TYPE,
  definitionApi,
  parseDraftEtag,
  type BodyOf,
  type ParamsOf,
  type QueryOf,
  type QuestionnaireDraft,
  type RouteDefinition,
  type VersionSummary,
} from "@qp/shared";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { UnexpectedResponseError, problemErrorFrom } from "./problem-error";

type DefinitionRoute = (typeof definitionApi.definitionRoutes)[number];

type DraftEtagRoute =
  | typeof definitionApi.getDraft
  | typeof definitionApi.openDraft
  | typeof definitionApi.replaceDraft
  | typeof definitionApi.publishDraft;

export type PlainDefinitionRoute = Exclude<DefinitionRoute, DraftEtagRoute>;

type RouteWith<Status extends number> = RouteDefinition & { schema: { response: Record<Status, TSchema> } };
type SuccessBody<R extends RouteWith<Status>, Status extends number> = Static<R["schema"]["response"][Status]>;

type Declares<R extends RouteDefinition, K extends "params" | "querystring" | "body" | "headers"> =
  R["schema"] extends Record<K, TSchema> ? true : false;

export type RequestParts<R extends RouteDefinition> = (Declares<R, "params"> extends true
  ? { params: ParamsOf<R> }
  : { params?: never }) &
  (Declares<R, "querystring"> extends true ? { query?: QueryOf<R> } : { query?: never }) &
  (Declares<R, "body"> extends true ? { body: BodyOf<R> } : { body?: never }) &
  (Declares<R, "headers"> extends true ? { ifMatch: string } : { ifMatch?: never }) & { signal?: AbortSignal };

type Scalar = string | number | boolean;

interface LooseParts {
  params?: Record<string, Scalar>;
  query?: Record<string, Scalar | undefined>;
  body?: unknown;
  ifMatch?: string;
  signal?: AbortSignal;
}

interface Exchange<Body> {
  status: number;
  body: Body;
  headers: Headers;
}

function pathOf(url: string, params: Record<string, Scalar> | undefined): string {
  return url.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${url}`);
    return encodeURIComponent(String(value));
  });
}

function searchOf(query: Record<string, Scalar | undefined> | undefined): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(name, String(value));
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

export function definitionUrl(route: RouteDefinition, parts: Pick<LooseParts, "params" | "query"> = {}): string {
  return `${definitionApi.DEFINITION_PREFIX}${pathOf(route.url, parts.params)}${searchOf(parts.query)}`;
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

function successSchemaOf(route: RouteDefinition, status: number): TSchema | undefined {
  const code = String(status);
  return code.endsWith("xx") ? undefined : route.schema.response[code];
}

async function checkedExchange(route: RouteDefinition, parts: LooseParts): Promise<Exchange<unknown>> {
  const headers = new Headers({ accept: `application/json, ${PROBLEM_CONTENT_TYPE}` });
  if (parts.body !== undefined) headers.set("content-type", "application/json");
  if (parts.ifMatch !== undefined) headers.set("if-match", parts.ifMatch);

  const response = await fetch(definitionUrl(route, parts), {
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

export interface VersionedDraft {
  draft: QuestionnaireDraft;
  etag: string;
}

export type DraftContent = BodyOf<typeof definitionApi.replaceDraft>;

function versionedDraft({ status, body, headers }: Exchange<QuestionnaireDraft>): VersionedDraft {
  const etag = headers.get("etag");
  const parsed = etag === null ? undefined : parseDraftEtag(etag);
  if (etag === null || parsed?.versionId !== body.versionId.toLowerCase()) {
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
