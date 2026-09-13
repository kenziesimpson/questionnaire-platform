/**
 * @qp/telemetry — the single telemetry boundary ([[6-observability]] §3.1, Layer 1). The only module
 * permitted to import `pino` or `@opentelemetry/*`; everything else logs, traces and counts through
 * the functions below, whose inputs are closed types with no `...rest`, no `Record<string, unknown>`
 * and no `any`. An answer value has nowhere to go.
 *
 * This is the signature Wave 1a fixes. The bodies are no-ops until Track 8 wires pino and OTel behind
 * them, so every handler written in between already calls the boundary rather than a logger.
 */
import type { ResponseType, SubmissionItemCode } from "@qp/shared";

/** The standard attributes of [[6-observability]] §2.1. Identifiers, types and outcomes — never values. */
export interface TelemetryContext {
  readonly sessionId?: string;
  readonly questionnaireId?: string;
  readonly questionnaireVersion?: number;
  readonly itemId?: string;
  readonly questionId?: string;
  readonly questionType?: ResponseType;
  readonly outcome?: Outcome;
}

export type Outcome = "accepted" | "rejected_validation" | "rejected_conflict" | "failed";

export type SpanName = "questionnaire.publish" | "rule.evaluate" | "session.submit";

/** Domain events ([[6-observability]] §4), each emitted as a paired log line and counter so the two cannot drift. */
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
  /** Predicates carry no id of their own, so the hidden item names the predicate (#41). */
  | { readonly name: "session.item_skipped"; readonly sessionId: string; readonly itemId: string; readonly questionId: string }
  | { readonly name: "session.abandoned"; readonly sessionId: string; readonly lastItemId: string | null }
  | {
      readonly name: "session.completed";
      readonly sessionId: string;
      readonly durationMs: number;
      readonly questionCount: number;
    };

/**
 * A log message must be a string literal. `string` and interpolated templates such as
 * `` `rejected ${string}` `` both map to an index signature, which `{}` satisfies, so both are
 * rejected — domain data goes in `context`, where only closed fields exist.
 */
export type LiteralMessage<M extends string> = {} extends Record<M, 1> ? never : M;

export type LogLevel = "debug" | "info" | "warn" | "error";

export function log<M extends string>(
  _level: LogLevel,
  _message: LiteralMessage<M>,
  _context?: TelemetryContext,
  _error?: Error,
): void {}

export function emitDomainEvent(_event: DomainEvent): void {}

export async function withSpan<T>(_name: SpanName, _context: TelemetryContext, fn: () => Promise<T>): Promise<T> {
  return fn();
}
