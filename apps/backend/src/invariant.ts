import type { LiteralMessage, TelemetryContext } from "@qp/telemetry";

export type InvariantIds = Pick<
  TelemetryContext,
  "questionnaireId" | "questionnaireVersion" | "questionnaireVersionId" | "sessionId" | "questionId" | "itemId"
>;

export class InvariantViolation extends Error {
  readonly invariant: string;
  readonly ids: InvariantIds;

  private constructor(invariant: string, ids: InvariantIds) {
    super(invariant);
    this.name = "InvariantViolation";
    this.invariant = invariant;
    this.ids = ids;
  }

  static of<N extends string>(invariant: LiteralMessage<N>, ids: InvariantIds = {}): InvariantViolation {
    return new InvariantViolation(invariant, ids);
  }
}
