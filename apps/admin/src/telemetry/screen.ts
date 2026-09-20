const ROUTE_ID_PREFIX = "/";

interface MatchedRoutes {
  readonly state: { readonly matches: readonly { readonly routeId: string }[] };
}

export function routeTemplateOf(router: MatchedRoutes): string | undefined {
  const routeId = router.state.matches.at(-1)?.routeId;
  return routeId?.startsWith(ROUTE_ID_PREFIX) === true ? routeId : undefined;
}
