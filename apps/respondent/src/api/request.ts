import { executionApi, PROBLEM_CONTENT_TYPE, problemFromWire, type HttpMethod, type WireProblem } from "@qp/shared";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ExecutionProblem, ExecutionProblemSlug } from "./problems.ts";

export type ExecutionOutcome<Body, S extends ExecutionProblemSlug> =
  | { readonly kind: "ok"; readonly body: Body }
  | ({ readonly kind: "problem" } & ExecutionProblem<S>)
  | { readonly kind: "network-error" }
  | { readonly kind: "unexpected-response"; readonly status: number };

export interface ExecutionRequest<Success extends TSchema, S extends ExecutionProblemSlug> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly body?: string;
  readonly success: { readonly status: number; readonly schema: Success };
  readonly problems: readonly S[];
}

interface Exchange {
  readonly status: number;
  readonly text: string;
}

async function exchange({ method, path, body }: ExecutionRequest<TSchema, ExecutionProblemSlug>): Promise<Exchange | undefined> {
  const headers: Record<string, string> = { accept: `application/json, ${PROBLEM_CONTENT_TYPE}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const response = await fetch(executionApi.EXECUTION_PREFIX + path, { method, headers, body });
    return { status: response.status, text: await response.text() };
  } catch {
    return undefined;
  }
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRouteProblem<S extends ExecutionProblemSlug>(slugs: readonly S[], candidate: WireProblem): candidate is ExecutionProblem<S> {
  return slugs.some((slug) => slug === candidate.slug);
}

export async function sendExecutionRequest<Success extends TSchema, S extends ExecutionProblemSlug>(
  request: ExecutionRequest<Success, S>,
): Promise<ExecutionOutcome<Static<Success>, S>> {
  const exchanged = await exchange(request);
  if (exchanged === undefined) return { kind: "network-error" };

  const { status } = exchanged;
  const body = parsedJson(exchanged.text);
  if (status === request.success.status) {
    return Value.Check(request.success.schema, body) ? { kind: "ok", body } : { kind: "unexpected-response", status };
  }

  const parsed = problemFromWire(body);
  if (parsed !== undefined && parsed.problem.status === status && isRouteProblem(request.problems, parsed)) {
    return { kind: "problem", ...parsed };
  }
  return { kind: "unexpected-response", status };
}
