import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { App } from "../../src/app";
import { createAppRouter } from "../../src/router";

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

export function withQueryClient(children: ReactNode) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

export function renderAppAt(path: string, queryClient = testQueryClient()) {
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [`/admin${path}`] }) });
  const { container } = render(<App queryClient={queryClient} router={router} />);
  return { container, router, queryClient };
}
