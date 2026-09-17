import type { FastifyRequest } from "fastify";

export const AUTHOR_PLACEHOLDER = "prototype-author";

const authenticatedAuthors = new WeakMap<FastifyRequest, string>();

export async function authenticateAuthor(request: FastifyRequest): Promise<void> {
  authenticatedAuthors.set(request, AUTHOR_PLACEHOLDER);
}

export function authorOf(request: FastifyRequest): string {
  const author = authenticatedAuthors.get(request);
  if (author === undefined) {
    throw new Error("authorOf read a request that did not pass through the definition module's author hook");
  }
  return author;
}
