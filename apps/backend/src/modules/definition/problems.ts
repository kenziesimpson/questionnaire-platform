import { problem, type Problem } from "@qp/shared";
import type { CreateNextDraftOutcome, ReplaceDraftOutcome } from "../../db/definition/drafts.js";
import type { PublishDraftOutcome } from "../../db/definition/publish.js";
import type { SetClosesAtOutcome } from "../../db/definition/questionnaires.js";
import type { AppendQuestionVersionOutcome, ArchiveQuestionOutcome } from "../../db/definition/questions.js";
import { notFoundProblem } from "../../http/problems.js";

type DefinitionOutcome =
  | ReplaceDraftOutcome
  | CreateNextDraftOutcome
  | PublishDraftOutcome
  | SetClosesAtOutcome
  | AppendQuestionVersionOutcome
  | ArchiveQuestionOutcome;

type Accepted = { readonly outcome: "saved" | "created" | "published" | "updated" | "archived" | "already-archived" };

export type DefinitionRefusal = Exclude<DefinitionOutcome, Accepted>;

export function definitionProblem(refusal: DefinitionRefusal, instance: string): Problem {
  switch (refusal.outcome) {
    case "questionnaire-not-found":
    case "question-not-found":
    case "no-draft":
    case "nothing-published":
      return notFoundProblem(instance);
    case "stale":
      return problem("questionnaire/draft-stale", { instance });
    case "draft-exists":
      return problem("questionnaire/draft-exists", { instance });
    case "invalid":
      return problem("questionnaire/draft-invalid", { instance, items: [...refusal.items] });
    case "type-changed":
      return problem("request/invalid", { instance, errors: [{ pointer: "/body/question/type", code: "question/type-changed" }] });
  }
}
