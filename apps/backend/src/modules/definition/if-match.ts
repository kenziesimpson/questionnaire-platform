import { parseDraftEtag } from "@qp/shared";
import type { DraftPrecondition } from "../../db/definition/draft-precondition.js";

export class MalformedDraftPrecondition extends Error {
  constructor() {
    super("If-Match is not a draft ETag this server issued");
    this.name = "MalformedDraftPrecondition";
  }
}

export function draftPreconditionOf(ifMatch: string): DraftPrecondition {
  const parsed = parseDraftEtag(ifMatch);
  if (parsed === undefined) {
    throw new MalformedDraftPrecondition();
  }
  return parsed;
}
