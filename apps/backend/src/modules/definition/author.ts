import type { FastifyRequest } from "fastify";
import { PLACEHOLDER_ACTOR } from "../../http/placeholder-actor.js";
import { InvariantViolation } from "../../invariant.js";

export const AUTHOR_PLACEHOLDER = PLACEHOLDER_ACTOR;

const authenticatedAuthors = new WeakMap<FastifyRequest, string>();

export async function authenticateAuthor(request: FastifyRequest): Promise<void> {
  authenticatedAuthors.set(request, AUTHOR_PLACEHOLDER);
}

export function authorOf(request: FastifyRequest): string {
  const author = authenticatedAuthors.get(request);
  if (author === undefined) {
    throw InvariantViolation.of("author.read-outside-author-hook");
  }
  return author;
}
