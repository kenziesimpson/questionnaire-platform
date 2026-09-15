import { PROBLEM_CONTENT_TYPE, type Problem } from "@qp/shared";
import { vi, type Mock } from "vitest";

export interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

type Reply = () => Promise<Response>;

export function jsonReply(status: number, body: unknown): Reply {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

export function problemReply(body: Problem): Reply {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status: body.status, headers: { "content-type": PROBLEM_CONTENT_TYPE } }));
}

export function networkFailure(): Reply {
  return () => Promise.reject(new TypeError("Failed to fetch"));
}

export function heldReply(): { reply: Reply; release: (response: Reply) => Promise<void> } {
  let resolve: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return {
    reply: () => pending,
    release: async (response) => resolve(await response()),
  };
}

function parsedBody(body: BodyInit | null | undefined): unknown {
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

export class ExecutionServer {
  readonly requests: SentRequest[] = [];
  private readonly replies = new Map<string, Reply[]>();
  readonly fetch: Mock<typeof fetch>;

  constructor() {
    this.fetch = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      this.requests.push({ method, url, body: parsedBody(init?.body) });
      const reply = this.replies.get(`${method} ${url}`)?.shift();
      if (reply === undefined) return Promise.reject(new Error(`no reply queued for ${method} ${url}`));
      return reply();
    });
  }

  on(method: string, url: string, ...replies: Reply[]): this {
    const key = `${method} ${url}`;
    this.replies.set(key, [...(this.replies.get(key) ?? []), ...replies]);
    return this;
  }

  sent(method: string, url: string): SentRequest[] {
    return this.requests.filter((request) => request.method === method && request.url === url);
  }
}
