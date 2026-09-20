import Type from "typebox";

export const UUID_PATTERN = "^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$";
export const Uuid = Type.String({ format: "uuid" });

export const SLUG_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
export const Slug = Type.String({ pattern: SLUG_PATTERN });

export const ISO_YEAR_PATTERN = "(?!0000)[0-9]{4}";

export const IsoDate = Type.String({ format: "date", pattern: `^${ISO_YEAR_PATTERN}-` });

export const IsoDateTime = Type.String({
  format: "date-time",
  pattern: `^${ISO_YEAR_PATTERN}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-5][0-9](?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$`,
});

export const DECIMAL_PATTERN = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$";
const MAX_DECIMAL_LENGTH = 64;
export const DecimalString = Type.String({ pattern: DECIMAL_PATTERN, maxLength: MAX_DECIMAL_LENGTH });

const INT4_MAX = 2_147_483_647;
export const PositiveInt = Type.Integer({ minimum: 1, maximum: INT4_MAX });
export const NonNegativeInt = Type.Integer({ minimum: 0, maximum: INT4_MAX });
export const strict = { additionalProperties: false } as const;
