import type { BrowserContext, Page, Request, Response } from "@playwright/test";
import { definitionApi, executionApi, routePath, type PathParams, type RouteDefinition } from "@qp/shared";

type RouteParams = Readonly<Record<string, string | number>>;
type RequestSource = Page | BrowserContext;

function pathnameOf(url: string): string {
  return new URL(url).pathname;
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function matchesPath(prefix: string, url: string, params: RouteParams, pathname: string): boolean {
  const routeSegments = segmentsOf(prefix + url);
  const pathSegments = segmentsOf(pathname);
  if (routeSegments.length !== pathSegments.length) return false;
  return routeSegments.every((routeSegment, index) => {
    const pathSegment = pathSegments[index];
    if (!routeSegment.startsWith(":")) return pathSegment === routeSegment;
    const value = params[routeSegment.slice(1)];
    return value === undefined || pathSegment === encodeURIComponent(String(value));
  });
}

function matchesRoute(request: Request, prefix: string, route: RouteDefinition, params: RouteParams = {}): boolean {
  return request.method() === route.method && matchesPath(prefix, route.url, params, pathnameOf(request.url()));
}

function matchesDefinitionRoute(request: Request, route: RouteDefinition, params: RouteParams = {}): boolean {
  return matchesRoute(request, definitionApi.DEFINITION_PREFIX, route, params);
}

export function matchesExecutionRoute(request: Request, route: RouteDefinition, params: RouteParams = {}): boolean {
  return matchesRoute(request, executionApi.EXECUTION_PREFIX, route, params);
}

export function isDefinitionRequest(request: Request): boolean {
  return pathnameOf(request.url()).startsWith(`${definitionApi.DEFINITION_PREFIX}/`);
}

export function recordRequests(source: RequestSource, matches: (request: Request) => boolean = () => true): Request[] {
  const recorded: Request[] = [];
  source.on("request", (request) => {
    if (matches(request)) recorded.push(request);
  });
  return recorded;
}

export function recordDefinitionRequests(page: Page, route: RouteDefinition, params: RouteParams = {}): Request[] {
  return recordRequests(page, (request) => matchesDefinitionRoute(request, route, params));
}

function waitForRouteResponse(page: Page, prefix: string, route: RouteDefinition, params: RouteParams = {}): Promise<Response> {
  return page.waitForResponse((response) => matchesRoute(response.request(), prefix, route, params));
}

export function waitForDefinitionResponse(page: Page, route: RouteDefinition, params: RouteParams = {}): Promise<Response> {
  return waitForRouteResponse(page, definitionApi.DEFINITION_PREFIX, route, params);
}

export function waitForExecutionResponse(page: Page, route: RouteDefinition, params: RouteParams = {}): Promise<Response> {
  return waitForRouteResponse(page, executionApi.EXECUTION_PREFIX, route, params);
}

export function definitionUrlPattern(route: RouteDefinition, params: PathParams = {}): string {
  return `**${definitionApi.DEFINITION_PREFIX}${routePath(route.url, params)}`;
}
