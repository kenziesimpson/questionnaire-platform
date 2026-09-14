import { QueryClient } from "@tanstack/react-query";
import { ProblemError } from "./problem-error";

const MAX_QUERY_RETRIES = 3;

export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  const isClientProblem = error instanceof ProblemError && error.status < 500;
  return !isClientProblem && failureCount < MAX_QUERY_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: shouldRetryQuery } } });
}
