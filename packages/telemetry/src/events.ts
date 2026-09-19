import type { ResponseType, SubmissionItemCode } from "@qp/shared";
import type { TelemetryContext } from "./fields.js";
import { countDomainEvent } from "./instruments.js";
import { logger } from "./logger.js";

export type DomainEvent =
  | { readonly name: "questionnaire.created"; readonly questionnaireId: string }
  | { readonly name: "questionnaire.published"; readonly questionnaireId: string; readonly questionnaireVersion: number }
  | { readonly name: "questionnaire.retired"; readonly questionnaireId: string }
  | {
      readonly name: "session.started";
      readonly sessionId: string;
      readonly questionnaireId: string;
      readonly questionnaireVersion: number;
    }
  | {
      readonly name: "session.resumed";
      readonly sessionId: string;
      readonly questionnaireId: string;
      readonly questionnaireVersion: number;
      readonly elapsedSeconds: number;
    }
  | {
      readonly name: "session.question_answered";
      readonly sessionId: string;
      readonly itemId: string;
      readonly questionId: string;
      readonly questionType: ResponseType;
    }
  | {
      readonly name: "session.answer_rejected";
      readonly sessionId: string;
      readonly itemId: string;
      readonly questionId: string;
      readonly reason: SubmissionItemCode;
    }
  | { readonly name: "session.item_skipped"; readonly sessionId: string; readonly itemId: string; readonly questionId: string }
  | { readonly name: "session.abandoned"; readonly sessionId: string; readonly lastItemId: string | null }
  | {
      readonly name: "session.completed";
      readonly sessionId: string;
      readonly durationMs: number;
      readonly questionCount: number;
    };

const eventLog = logger("events");

export function emitDomainEvent(event: DomainEvent): void {
  const { name, ...fields } = event;
  const context: TelemetryContext = fields;
  eventLog.info(name, context);
  countDomainEvent(event);
}
