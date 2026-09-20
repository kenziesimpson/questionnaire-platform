import type { TSchema } from "typebox";
import type { BodyOf, ParamsOf, QueryOf, RouteDefinition, RouteSchema } from "./route.js";

export type PathParams = Readonly<Record<string, string | number | boolean>>;
export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

const PATH_PARAMETER = /:([A-Za-z][A-Za-z0-9_]*)/g;

const NOT_A_PATH_SEGMENT: readonly string[] = ["", ".", ".."];

export function routePath(url: string, params: PathParams = {}): string {
  return url.replace(PATH_PARAMETER, (_segment, name: string) => {
    if (name.endsWith("_")) throw new Error(`Path parameter ":${name}" in ${url} ends in an underscore`);
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${url}`);
    const encoded = encodeURIComponent(String(value));
    if (NOT_A_PATH_SEGMENT.includes(encoded)) throw new Error(`Path parameter "${name}" for ${url} is empty or a relative segment`);
    return encoded;
  });
}

const NOT_FORM_URL_ENCODED = /[!'()~]|%20/g;

function formUrlEncoded(value: string): string {
  return encodeURIComponent(value).replace(NOT_FORM_URL_ENCODED, (character) =>
    character === "%20" ? "+" : `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function routeSearch(query: QueryParams = {}): string {
  const pairs = Object.entries(query).flatMap(([name, value]) =>
    value === undefined ? [] : [`${formUrlEncoded(name)}=${formUrlEncoded(String(value))}`],
  );
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

export function successSchemaOf(route: RouteDefinition, status: number): TSchema | undefined {
  return route.schema.response[String(status)];
}

type Declares<R extends RouteDefinition, K extends keyof RouteSchema> = R["schema"] extends Record<K, TSchema> ? true : false;

export type RequestParts<R extends RouteDefinition> = (Declares<R, "params"> extends true
  ? { params: ParamsOf<R> }
  : { params?: never }) &
  (Declares<R, "querystring"> extends true ? { query?: QueryOf<R> } : { query?: never }) &
  (Declares<R, "body"> extends true ? { body: BodyOf<R> } : { body?: never }) &
  (Declares<R, "headers"> extends true ? { ifMatch: string } : { ifMatch?: never });
