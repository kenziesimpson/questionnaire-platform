const PG_QUERY_SPAN = "pg.query";

export const PG_QUERY_SPAN_PREFIX = `${PG_QUERY_SPAN}:`;

const PG_CONNECT_SPANS = ["pg.connect", "pg-pool.connect"] as const;

export const PG_SPANS_EXPORTED_AS_WRITTEN: readonly string[] = [PG_QUERY_SPAN, ...PG_CONNECT_SPANS];

export function isDatabaseSpanName(name: string): boolean {
  return PG_SPANS_EXPORTED_AS_WRITTEN.includes(name) || name.startsWith(PG_QUERY_SPAN_PREFIX);
}
