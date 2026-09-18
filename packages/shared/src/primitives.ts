import Type from "typebox";

/** Bank rows, questionnaires, sessions and published versions. UUIDv7 or v4, never sequential. */
export const Uuid = Type.String({ format: "uuid" });

/**
 * Authored identifiers that live inside a document rather than as a row: `itemId`, `optionId`,
 * and the `key` slugs on questions and questionnaires. `yes`, `no` and `other` are reserved
 * option ids by editor convention (Decisions Log #36), not by this pattern.
 */
export const SLUG_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
export const Slug = Type.String({ pattern: SLUG_PATTERN });

/** A calendar date with no timezone — what a date question collects ([[9-database-schema]] §6.1). */
export const IsoDate = Type.String({ format: "date" });

export const IsoDateTime = Type.String({ format: "date-time" });

/**
 * A number answer on the wire (Decisions Log #42). A JSON number would be parsed into an IEEE
 * double before reaching the `numeric` column or the digest, so the exact decimal travels as text.
 * No exponent, no leading zeros, no `+`.
 */
export const DECIMAL_PATTERN = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$";
export const DecimalString = Type.String({ pattern: DECIMAL_PATTERN });

export const PositiveInt = Type.Integer({ minimum: 1 });
export const NonNegativeInt = Type.Integer({ minimum: 0 });
export const strict = { additionalProperties: false } as const;
