import { executionApi, type RouteDefinition } from "@qp/shared";
import Fastify, { type RouteOptions } from "fastify";
import { describe, expect, it } from "vitest";
import { executionModule } from "../../../src/modules/execution/plugin.js";
import { executionUrl, useExecutionApp } from "../../db/execution/fixtures.js";
import { useTestDatabase } from "../../db/harness.js";

const testDatabase = useTestDatabase();
const app = useExecutionApp(testDatabase);

interface RegisteredRoute {
  readonly method: RouteOptions["method"];
  readonly url: string;
  readonly schema: RouteOptions["schema"];
}

async function routesRegisteredByExecutionModule(): Promise<RegisteredRoute[]> {
  const registered: RegisteredRoute[] = [];
  const probe = Fastify();
  probe.addHook("onRoute", ({ method, url, schema }) => {
    registered.push({ method, url, schema });
  });
  await probe.register(executionModule, {
    database: testDatabase.database("execution"),
    prefix: executionApi.EXECUTION_PREFIX,
  });
  await probe.ready();
  await probe.close();
  return registered;
}

function routeKey({ method, url }: { readonly method: RouteOptions["method"]; readonly url: string }): string {
  return `${String(method)} ${url}`;
}

function sharedRouteKey(route: RouteDefinition): string {
  return routeKey({ method: route.method, url: executionUrl(route.url) });
}

describe("execution route completeness", () => {
  it("registers every shared execution route at its method and prefixed URL with the shared schema object, and nothing else", async () => {
    const registered = await routesRegisteredByExecutionModule();
    const explicitlyRegistered = registered.filter((route) => route.method !== "HEAD");

    expect(explicitlyRegistered.map(routeKey).sort()).toEqual(executionApi.executionRoutes.map(sharedRouteKey).sort());
    for (const shared of executionApi.executionRoutes) {
      const match = explicitlyRegistered.find((route) => routeKey(route) === sharedRouteKey(shared));
      expect(match?.schema, sharedRouteKey(shared)).toBe(shared.schema);
    }
  });

  it("routes every shared execution route on the harness app", () => {
    const unrouted = executionApi.executionRoutes.filter(
      (route) => !app().hasRoute({ method: route.method, url: executionUrl(route.url) }),
    );

    expect(unrouted.map(sharedRouteKey)).toEqual([]);
  });
});
