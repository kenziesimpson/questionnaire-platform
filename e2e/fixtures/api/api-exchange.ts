import type { APIRequestContext } from "@playwright/test";
import { ProblemDetails, problemSlug, type HttpMethod, type ProblemDetailsWire, type ProblemSlug, type RouteDefinition } from "@qp/shared";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export type PathParams = Readonly<Record<string, string | number>>;
export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

export interface ApiRequestParts {
  readonly params?: PathParams;
  readonly query?: QueryParams;
  readonly body?: unknown;
  readonly ifMatch?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ApiExchange {
  readonly method: HttpMethod;
  readonly path: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export class ApiProblemError extends Error {
  readonly exchange: ApiExchange;
  readonly status: number;
  readonly problem: ProblemDetailsWire | undefined;
  readonly slug: ProblemSlug | undefined;

  constructor(exchange: ApiExchange, expectedStatus: number) {
    const problem = Value.Check(ProblemDetails, exchange.body) ? exchange.body : undefined;
    const slug = problem === undefined ? undefined : problemSlug(problem.type);
    super(
      `${exchange.method} ${exchange.path} answered ${exchange.status}${slug === undefined ? "" : ` ${slug}`}, expected ${expectedStatus}: ${JSON.stringify(exchange.body)}`,
    );
    this.name = "ApiProblemError";
    this.exchange = exchange;
    this.status = exchange.status;
    this.problem = problem;
    this.slug = slug;
  }
}

export class ApiContractError extends Error {
  constructor(exchange: ApiExchange, schema: TSchema) {
    const errors = Value.Errors(schema, exchange.body)
      .slice(0, 5)
      .map((error) => `${error.instancePath || "/"} ${error.message}`);
    super(`${exchange.method} ${exchange.path} answered ${exchange.status} with a body outside its contract: ${errors.join("; ")}`);
    this.name = "ApiContractError";
  }
}

export function pathFor(prefix: string, url: string, params: PathParams = {}): string {
  return (
    prefix +
    url.replace(/:([A-Za-z]+)/g, (_segment, name: string) => {
      const value = params[name];
      if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${url}`);
      return encodeURIComponent(String(value));
    })
  );
}

function searchFor(query: QueryParams | undefined): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(name, String(value));
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function bodyOf(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function sendRouteRequest(
  request: APIRequestContext,
  prefix: string,
  route: RouteDefinition,
  parts: ApiRequestParts = {},
): Promise<ApiExchange> {
  const path = pathFor(prefix, route.url, parts.params) + searchFor(parts.query);
  const headers: Record<string, string> = { accept: "application/json, application/problem+json", ...parts.headers };
  if (parts.ifMatch !== undefined) headers["if-match"] = parts.ifMatch;
  if (parts.body !== undefined) headers["content-type"] = "application/json";
  const response = await request.fetch(path, {
    method: route.method,
    headers,
    data: parts.body === undefined ? undefined : JSON.stringify(parts.body),
    failOnStatusCode: false,
  });
  return {
    method: route.method,
    path,
    status: response.status(),
    headers: response.headers(),
    body: bodyOf(await response.text()),
  };
}

export function expectBody<S extends TSchema>(exchange: ApiExchange, status: number, schema: S): Static<S> {
  if (exchange.status !== status) throw new ApiProblemError(exchange, status);
  if (!Value.Check(schema, exchange.body)) throw new ApiContractError(exchange, schema);
  return exchange.body;
}
