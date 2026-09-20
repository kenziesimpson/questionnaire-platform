import { parseDraftEtag, problem, type DraftPrecondition, type Problem } from "@qp/shared";

export function draftPreconditionOf(ifMatch: string): DraftPrecondition | Problem {
  return parseDraftEtag(ifMatch) ?? problem("request/invalid", { errors: [{ pointer: "/headers/if-match", code: "schema/pattern" }] });
}
