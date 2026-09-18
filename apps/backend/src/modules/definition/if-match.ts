import { parseDraftEtag, problem, type Problem } from "@qp/shared";
import type { DraftPrecondition } from "../../db/definition/draft-precondition.js";

export function draftPreconditionOf(ifMatch: string): DraftPrecondition | Problem {
  return parseDraftEtag(ifMatch) ?? problem("request/invalid", { errors: [{ pointer: "/headers/if-match", code: "schema/pattern" }] });
}
