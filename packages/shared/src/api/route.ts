import type { Static, TSchema } from "typebox";
import { ProblemDetails } from "../problems.js";

export type HttpMethod = "GET" | "POST" | "PUT";

export interface RouteSchema {
  params?: TSchema;
  querystring?: TSchema;
  headers?: TSchema;
  body?: TSchema;
  response: Record<string, TSchema>;
}

export interface RouteDefinition<S extends RouteSchema = RouteSchema> {
  method: HttpMethod;
  /** Relative to the module's mount point: `/api/definition` or `/api/run`. */
  url: string;
  schema: S;
}

/**
 * One route's contract: Fastify registers `schema` as-is, and clients derive their types from it.
 * Every route declares the problem body for `4xx` and `5xx`, so error serialization is contractual too.
 */
export function defineRoute<const M extends HttpMethod, const U extends string, S extends RouteSchema>(route: {
  method: M;
  url: U;
  schema: S;
}) {
  return {
    method: route.method,
    url: route.url,
    schema: { ...route.schema, response: { ...route.schema.response, "4xx": ProblemDetails, "5xx": ProblemDetails } },
  } as { method: M; url: U; schema: S & { response: S["response"] & { "4xx": typeof ProblemDetails; "5xx": typeof ProblemDetails } } };
}

type Field<R extends RouteDefinition, K extends keyof RouteSchema> = R["schema"][K] extends TSchema
  ? Static<R["schema"][K]>
  : never;

export type ParamsOf<R extends RouteDefinition> = Field<R, "params">;
export type QueryOf<R extends RouteDefinition> = Field<R, "querystring">;
export type HeadersOf<R extends RouteDefinition> = Field<R, "headers">;
export type BodyOf<R extends RouteDefinition> = Field<R, "body">;
export type ReplyOf<R extends RouteDefinition, Code extends keyof R["schema"]["response"]> =
  R["schema"]["response"][Code] extends TSchema ? Static<R["schema"]["response"][Code]> : never;
