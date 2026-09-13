const REDACTED = "[redacted]";

/**
 * A respondent answer value. Every way of turning it into text yields `[redacted]` — `JSON.stringify`,
 * template interpolation, `String()`, `console.log`, `util.inspect`, an OTel attribute — so an
 * accidental leak into a log, span or error message is structurally prevented rather than forbidden
 * ([[6-observability]] §3.1, Layer 0). `unwrap()` is the only way out, and belongs in persistence
 * and validation code only.
 */
export class Sensitive<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  unwrap(): T {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

export function sensitive<T>(value: T): Sensitive<T> {
  return new Sensitive(value);
}
