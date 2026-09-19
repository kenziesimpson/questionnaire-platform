import { executionApi, problem, sensitive, type Problem } from "@qp/shared";
import { withSpan } from "@qp/telemetry";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/client.js";
import { PublishedDefinitions } from "../../db/execution/published-definitions.js";
import { resumeSession, sessionView, startSession, type SessionWithDefinitionOutcome } from "../../db/execution/sessions.js";
import { submitSession, type SubmitOutcome } from "../../db/execution/submit.js";
import { applyHttpDefaults, notFoundProblem, replyWithProblem } from "../../http/problems.js";
import { registerRoute } from "../../http/routes.js";
import { reportSessionResumed, reportSessionStarted, reportSubmit, reportSubmitFailed } from "./session-events.js";

export interface ExecutionModuleOptions {
  readonly database: Database;
}

type Refusal = Exclude<SessionWithDefinitionOutcome | SubmitOutcome, { readonly outcome: "found" | "submitted" | "replayed" }>;

function problemFor(refusal: Refusal): Problem {
  switch (refusal.outcome) {
    case "not-found":
      return notFoundProblem();
    case "closed":
      return problem("questionnaire/closed");
    case "already-submitted":
      return problem("session/already-submitted");
    case "invalid":
      return problem("submission/invalid", { items: [...refusal.items] });
  }
}

export async function executionModule(scope: FastifyInstance, { database }: ExecutionModuleOptions): Promise<void> {
  const definitions = new PublishedDefinitions();

  applyHttpDefaults(scope, replyWithProblem);
  scope.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  registerRoute(scope, executionApi.createSession, async (request) => {
    const started = await startSession(database, definitions, request.body.questionnaireId, new Date());
    if (started.outcome !== "found") {
      return problemFor(started);
    }
    reportSessionStarted(started.session);
    return { status: 201, body: { session: sessionView(started.session), definition: started.definition } };
  });

  registerRoute(scope, executionApi.getSession, async (request) => {
    const now = new Date();
    const resumed = await resumeSession(database, definitions, request.params.sessionId, now);
    if (resumed.outcome !== "found") {
      return problemFor(resumed);
    }
    reportSessionResumed(resumed.session, now);
    return { status: 200, body: { session: sessionView(resumed.session), definition: resumed.definition } };
  });

  registerRoute(scope, executionApi.submitSession, async (request) => {
    const submitted = await withSpan("session.submit", { sessionId: request.params.sessionId }, async () => {
      const outcome = await submitSession(database, definitions, {
        sessionId: request.params.sessionId,
        answers: sensitive(request.body.answers),
        now: new Date(),
      }).catch((error: unknown) => {
        reportSubmitFailed(request.params.sessionId);
        throw error;
      });
      reportSubmit(outcome);
      return outcome;
    });
    if (submitted.outcome !== "submitted" && submitted.outcome !== "replayed") {
      return problemFor(submitted);
    }
    return { status: 200, body: { receipt: submitted.receipt } };
  });
}
