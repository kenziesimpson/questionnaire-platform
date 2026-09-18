import {
  PROBLEM_CONTENT_TYPE,
  problem,
  routePath,
  routeSearch,
  successSchemaOf,
  type HttpMethod,
  type PathParams,
  type Problem,
  type ProblemInit,
  type ProblemSlug,
  type QueryParams,
  type RouteDefinition,
} from "@qp/shared";
import { Value } from "typebox/value";
import { vi, type Mock } from "vitest";

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

export type Reply = (request: RecordedRequest) => Response | Promise<Response>;

export interface RouteParts {
  readonly params?: PathParams;
  readonly query?: QueryParams;
}

export function urlOf(prefix: string, route: RouteDefinition, { params, query }: RouteParts = {}): string {
  return `${prefix}${routePath(route.url, params)}${routeSearch(query)}`;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function problemBodyResponse(body: Problem): Response {
  return new Response(JSON.stringify(body), { status: body.status, headers: { "content-type": PROBLEM_CONTENT_TYPE } });
}

export function problemResponse<S extends ProblemSlug>(
  slug: S,
  ...init: {} extends ProblemInit<S> ? [ProblemInit<S>?] : [ProblemInit<S>]
): Response {
  return problemBodyResponse(problem(slug, ...init));
}

export function contractResponse(route: RouteDefinition, status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const schema = successSchemaOf(route, status);
  if (schema === undefined || !Value.Check(schema, body)) {
    throw new Error(`the fake answered ${route.method} ${route.url} with a ${status} body the contract rejects`);
  }
  return jsonResponse(status, body, headers);
}

export function jsonReply(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return () => jsonResponse(status, body, headers);
}

export function problemReply(body: Problem): Reply {
  return () => problemBodyResponse(body);
}

export function networkFailure(): Reply {
  return () => Promise.reject(new TypeError("Failed to fetch"));
}

export function respondInOrder(...responses: Response[]): Reply {
  return () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("fetch was called more often than the test expected");
    return next;
  };
}

export function heldReply(): { reply: Reply; release: (response: Reply) => Promise<void> } {
  let heldRequest: RecordedRequest | undefined;
  let resolve: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return {
    reply: (request) => {
      heldRequest = request;
      return pending;
    },
    release: async (response) => {
      if (heldRequest === undefined) throw new Error("the held reply was released before a request reached it");
      resolve(await response(heldRequest));
    },
  };
}

function parsedBody(body: BodyInit | null | undefined): unknown {
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

function noReplyQueued({ method, url }: RecordedRequest): Promise<Response> {
  return Promise.reject(new Error(`no reply queued for ${method} ${url}`));
}

export class FakeServer {
  readonly requests: RecordedRequest[] = [];
  readonly fetch: Mock<typeof fetch>;
  private readonly queued = new Map<string, Reply[]>();

  constructor(unqueued: Reply = noReplyQueued) {
    this.fetch = vi.fn<typeof fetch>((input, init) => {
      const request: RecordedRequest = {
        method: init?.method ?? "GET",
        url: String(input),
        headers: new Headers(init?.headers),
        body: parsedBody(init?.body),
      };
      this.requests.push(request);
      const reply = this.queued.get(`${request.method} ${request.url}`)?.shift() ?? unqueued;
      try {
        return Promise.resolve(reply(request));
      } catch (failure) {
        return Promise.reject(failure);
      }
    });
  }

  install(): this {
    vi.stubGlobal("fetch", this.fetch);
    return this;
  }

  on(method: HttpMethod, url: string, ...replies: Reply[]): this {
    const key = `${method} ${url}`;
    this.queued.set(key, [...(this.queued.get(key) ?? []), ...replies]);
    return this;
  }

  sent(method: HttpMethod, url: string): RecordedRequest[] {
    return this.requests.filter((request) => request.method === method && request.url === url);
  }
}

export function stubFetch(reply: Reply): RecordedRequest[] {
  return new FakeServer(reply).install().requests;
}
