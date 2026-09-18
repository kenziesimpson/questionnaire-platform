import Type from "typebox";

export const Uuid = Type.String({ format: "uuid" });

export const SLUG_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
export const Slug = Type.String({ pattern: SLUG_PATTERN });

export const IsoDate = Type.String({ format: "date" });

export const IsoDateTime = Type.String({ format: "date-time" });

export const DECIMAL_PATTERN = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$";
export const DecimalString = Type.String({ pattern: DECIMAL_PATTERN });

export const PositiveInt = Type.Integer({ minimum: 1 });
export const NonNegativeInt = Type.Integer({ minimum: 0 });
export const strict = { additionalProperties: false } as const;
