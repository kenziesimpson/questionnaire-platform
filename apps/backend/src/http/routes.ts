import type { BodyOf, HeadersOf, ParamsOf, Problem, QueryOf, ReplyOf, RouteDefinition } from "@qp/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sendProblem } from "./problems.js";

type Declared<T> = [T] extends [never] ? unknown : T;

type SuccessStatus<R extends RouteDefinition> = Exclude<keyof R["schema"]["response"], "4xx" | "5xx">;

export type RouteRequest<R extends RouteDefinition> = FastifyRequest<{
  Params: Declared<ParamsOf<R>>;
  Querystring: Declared<QueryOf<R>>;
  Headers: Declared<HeadersOf<R>>;
  Body: Declared<BodyOf<R>>;
}>;

export type RouteSuccess<R extends RouteDefinition> = {
  [S in SuccessStatus<R>]: {
    readonly status: S;
    readonly body: ReplyOf<R, S>;
    readonly headers?: Readonly<Record<string, string>>;
  };
}[SuccessStatus<R>];

export type RouteResponse<R extends RouteDefinition> = RouteSuccess<R> | Problem;

export type RouteHandler<R extends RouteDefinition> = (request: RouteRequest<R>) => Promise<RouteResponse<R>>;

function isSuccess<R extends RouteDefinition>(response: RouteResponse<R>): response is RouteSuccess<R> {
  return "body" in response;
}

export function registerRoute<R extends RouteDefinition>(scope: FastifyInstance, route: R, handler: RouteHandler<R>): void {
  scope.route({
    method: route.method,
    url: route.url,
    schema: route.schema,
    handler: async (request, reply) => {
      const response = await handler(request as RouteRequest<R>);
      if (!isSuccess(response)) {
        return sendProblem(reply, response);
      }
      return reply
        .code(response.status as number)
        .headers(response.headers ?? {})
        .send(response.body);
    },
  });
}
