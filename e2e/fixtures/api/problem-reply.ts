import { problemFromWire, type Problem, type ProblemSlug } from "@qp/shared";
import type { Response } from "@playwright/test";
import type { ApiExchange } from "./api-exchange.ts";

export interface ProblemReply {
  readonly status: number;
  readonly slug: ProblemSlug | undefined;
  readonly problem: Problem | undefined;
}

export function problemReplyOf(status: number, body: unknown): ProblemReply {
  const parsed = problemFromWire(body);
  return { status, slug: parsed?.slug, problem: parsed?.problem };
}

export function problemOf<S extends ProblemSlug>(reply: ProblemReply, slug: S): Problem<S> {
  if (reply.slug !== slug || reply.problem === undefined) {
    throw new Error(`Expected ${slug}, got ${reply.slug ?? "a body outside the problem contract"} with status ${reply.status}`);
  }
  return reply.problem as Problem<S>;
}

export function problemReplyOfExchange(exchange: ApiExchange): ProblemReply {
  return problemReplyOf(exchange.status, exchange.body);
}

export async function problemReplyOfResponse(response: Response): Promise<ProblemReply> {
  return problemReplyOf(response.status(), await response.json());
}
