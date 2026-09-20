import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_ATTRIBUTES, EVENT_LOOP_METRIC_NAMES, FIELDS, LOG_LEVELS, PG_OPERATION_DURATION, POOL_METRICS } from "@qp/telemetry";
import { CLIENT_LOG_LEVELS } from "@qp/telemetry/browser";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const GRAFANA_DIRECTORY = resolve(repoRoot, "observability/grafana");
const DASHBOARDS_DIRECTORY = resolve(GRAFANA_DIRECTORY, "dashboards");

const DASHBOARD_TITLES = ["Admin and authoring", "Client", "Database", "Respondent funnel", "Service health"];

const ALERT_TITLES = [
  "Submit success rate drops",
  "5xx rate rises",
  "p95 of the questionnaire definition fetch rises",
  "Event-loop lag stays high",
  "Requests stay queued for a pool connection",
  "Fewer than one month of future response partitions remain",
];

const CLIENT_ALERT_TITLES = ["Client errors per page load rise", "The ingest drops what browsers send", "Page load p75 degrades"];

const SEVERITIES = ["page", "ticket"];

const NO_DATA_STATES = ["OK", "Alerting", "NoData"];

const PROMETHEUS = "prometheus";

const LOKI = "loki";

const PROVISIONING_DIRECTORY = "/otel-lgtm/grafana/conf/provisioning";

const OUR_METRIC_PREFIX = /^(?:questionnaire|db|nodejs|traces|qp|telemetry|postgresql|browser)_/;

type Kind = "counter" | "updown" | "gauge" | "histogram";

interface OtelMetric {
  readonly name: string;
  readonly kind: Kind;
  readonly unit: string;
  readonly labels: readonly string[];
}

const RESOURCE_LABELS = ["service_name", "job", "instance"];

const SPAN_METRICS_BUILT_IN_LABELS = ["service_name", "span_name", "span_kind", "status_code"];

const QUERY_DURATION_LABELS = ["db_operation_name", "db_namespace", "server_address", "server_port"];

const UNIT_SUFFIXES: Readonly<Record<string, string>> = { ms: "_milliseconds", s: "_seconds", By: "_bytes" };

const EVENT_LOOP_UTILIZATION = "nodejs.eventloop.utilization";

function databaseAndRuntimeMetrics(): OtelMetric[] {
  const poolLabel = FIELDS.pool.attribute.replaceAll(".", "_");
  return [
    ...Object.values(POOL_METRICS).map((name): OtelMetric => ({ name, kind: "gauge", unit: "{connection}", labels: [poolLabel] })),
    ...EVENT_LOOP_METRIC_NAMES.map((name): OtelMetric => ({ name, kind: "gauge", unit: name === EVENT_LOOP_UTILIZATION ? "1" : "s", labels: [] })),
    { name: PG_OPERATION_DURATION, kind: "histogram", unit: "s", labels: QUERY_DURATION_LABELS },
  ];
}

const POSTGRESQL_RECEIVER_METRICS: readonly OtelMetric[] = [
  { name: "postgresql.backends", kind: "updown", unit: "1", labels: ["db_namespace"] },
  { name: "postgresql.connection.max", kind: "gauge", unit: "{connections}", labels: [] },
  { name: "postgresql.db_size", kind: "updown", unit: "By", labels: ["db_namespace"] },
  { name: "postgresql.commits", kind: "counter", unit: "1", labels: ["db_namespace"] },
  { name: "postgresql.rollbacks", kind: "counter", unit: "1", labels: ["db_namespace"] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(parent: unknown, key: string): Record<string, unknown> {
  const child = isRecord(parent) ? parent[key] : undefined;
  if (!isRecord(child)) throw new Error(`no mapping at "${key}"`);
  return child;
}

function listAt(parent: unknown, key: string): unknown[] {
  const child = isRecord(parent) ? parent[key] : undefined;
  if (!Array.isArray(child)) throw new Error(`no list at "${key}"`);
  return child;
}

function textAt(parent: unknown, key: string): string {
  const child = isRecord(parent) ? parent[key] : undefined;
  if (typeof child !== "string") throw new Error(`no string at "${key}"`);
  return child;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const collectorConfig: unknown = parse(read(resolve(repoRoot, "observability/collector.yaml")));
const composeConfig: unknown = parse(read(resolve(repoRoot, "docker-compose.yml")));
const eventsSource = read(resolve(repoRoot, "packages/telemetry/src/events.ts"));
const instrumentsSource = read(resolve(repoRoot, "packages/telemetry/src/instruments.ts"));
const vocabularySource = read(resolve(repoRoot, "packages/telemetry/src/vocabulary.ts"));
const wireContractSource = read(resolve(repoRoot, "packages/telemetry/src/wire-contract.ts"));

function labelOfField(field: string): string {
  const entry = Object.entries(FIELDS).find(([name]) => name === field);
  if (entry === undefined) throw new Error(`events.ts labels a counter with "${field}", which is not a registry field`);
  return entry[1].attribute.replaceAll(".", "_");
}

const SCRUB_COUNTER_LABELS: Readonly<Record<string, readonly string[]>> = {
  "telemetry.scrub.dropped": ["telemetry_signal", "telemetry_reason"],
  "telemetry.ingest.dropped": ["telemetry_ingest_reason"],
};

function applicationMetrics(): OtelMetric[] {
  const counters = [...eventsSource.matchAll(/>\(\s*"(questionnaire\.[a-z_.]+)"(?:,\s*\{\s*labels:\s*\[([^\]]*)\])?/g)].map(
    (match): OtelMetric => ({
      name: match[1] ?? "",
      kind: "counter",
      unit: "",
      labels: [...(match[2] ?? "").matchAll(/"(\w+)"/g)].map((label) => labelOfField(label[1] ?? "")),
    }),
  );
  const scrubCounters = [...instrumentsSource.matchAll(/(?:DROPPED_COUNTER|INGEST_DROPPED_COUNTER) = "([^"]+)"/g)].map(
    (match): OtelMetric => ({ name: match[1] ?? "", kind: "counter", unit: "", labels: SCRUB_COUNTER_LABELS[match[1] ?? ""] ?? [] }),
  );
  const durationUnit = /createHistogram\(name, \{\s*unit: "([^"]+)"/.exec(instrumentsSource)?.[1] ?? "";
  const durations = [...instrumentsSource.matchAll(/(?:SESSION_DURATION|PAGE_LOAD_DURATION) = "([^"]+)"/g)].map(
    (match): OtelMetric => ({ name: match[1] ?? "", kind: "histogram", unit: durationUnit, labels: [] }),
  );
  return [...counters, ...scrubCounters, ...durations];
}

function collectorMetrics(): OtelMetric[] {
  const spanMetrics = recordAt(recordAt(collectorConfig, "connectors"), "span_metrics");
  const namespace = textAt(spanMetrics, "namespace");
  const histogramUnit = textAt(recordAt(spanMetrics, "histogram"), "unit");
  const dimensions = listAt(spanMetrics, "dimensions").map((dimension) => textAt(dimension, "name").replaceAll(".", "_"));
  const spanLabels = [...dimensions, ...SPAN_METRICS_BUILT_IN_LABELS];
  const queries = listAt(recordAt(recordAt(collectorConfig, "receivers"), "sql_query/monitor"), "queries");
  const queried = queries.flatMap((query) =>
    listAt(query, "metrics").map((metric): OtelMetric => ({ name: textAt(metric, "metric_name"), kind: "gauge", unit: textAt(metric, "unit"), labels: [] })),
  );
  return [
    { name: `${namespace}.calls`, kind: "counter", unit: "", labels: spanLabels },
    { name: `${namespace}.duration`, kind: "histogram", unit: histogramUnit, labels: spanLabels },
    ...queried,
  ];
}

function prometheusSeries({ name, kind, unit, labels }: OtelMetric): [string, readonly string[]][] {
  const base = name.replaceAll(".", "_");
  const unitSuffix = unit === "1" ? (kind === "gauge" ? "_ratio" : "") : (UNIT_SUFFIXES[unit] ?? "");
  const stem = `${base}${unitSuffix}`;
  if (kind === "counter") return [[stem.endsWith("_total") ? stem : `${stem}_total`, labels]];
  if (kind === "histogram") return [[`${stem}_bucket`, [...labels, "le"]], [`${stem}_sum`, labels], [`${stem}_count`, labels]];
  return [[stem, labels]];
}

const KNOWN_SERIES: ReadonlyMap<string, readonly string[]> = new Map(
  [...applicationMetrics(), ...collectorMetrics(), ...databaseAndRuntimeMetrics(), ...POSTGRESQL_RECEIVER_METRICS].flatMap(prometheusSeries),
);

const KNOWN_LABELS = new Set([...ALLOWED_ATTRIBUTES.map((attribute) => attribute.replaceAll(".", "_")), ...SPAN_METRICS_BUILT_IN_LABELS, "le"]);

function seriesIn(expression: string): string[] {
  return [...expression.matchAll(/\b[a-z][a-z0-9_]*\b/g)].map((match) => match[0]).filter((token) => OUR_METRIC_PREFIX.test(token) && !KNOWN_LABELS.has(token));
}

function labelNamesIn(matchers: string): string[] {
  return [...matchers.matchAll(/([a-z_][a-z0-9_]*)\s*(?:=~|!~|!=|=)\s*"/g)].map((match) => match[1] ?? "");
}

function selectorLabelsOutsideTheirSeries(expression: string): string[] {
  return [...expression.matchAll(/\b([a-z][a-z0-9_]*)\{([^}]*)\}/g)].flatMap((match) => {
    const allowed = new Set([...(KNOWN_SERIES.get(match[1] ?? "") ?? []), ...RESOURCE_LABELS]);
    return labelNamesIn(match[2] ?? "").filter((label) => !allowed.has(label)).map((label) => `${match[1]}{${label}}`);
  });
}

function groupingLabelsOutsideTheSeries(expression: string): string[] {
  const allowed = new Set([...seriesIn(expression).flatMap((series) => KNOWN_SERIES.get(series) ?? []), ...RESOURCE_LABELS]);
  return [...expression.matchAll(/\bby\s*\(([^)]*)\)/g)]
    .flatMap((match) => (match[1] ?? "").split(",").map((label) => label.trim()))
    .filter((label) => label !== "" && !allowed.has(label));
}

interface Query {
  readonly source: string;
  readonly expression: string;
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (isRecord(value)) {
    visit(value);
    for (const child of Object.values(value)) walk(child, visit);
  }
}

function dashboardFiles(): string[] {
  return readdirSync(DASHBOARDS_DIRECTORY).filter((name) => name.endsWith(".json")).sort();
}

function readBoard(file: string): unknown {
  return JSON.parse(read(resolve(DASHBOARDS_DIRECTORY, file)));
}

const dashboards = dashboardFiles().map((file) => ({ file, board: readBoard(file) }));

const alertGroups = listAt(parse(read(resolve(GRAFANA_DIRECTORY, "alert-rules.yaml"))), "groups");
const alertRules = alertGroups.flatMap((group) => listAt(group, "rules"));
const clientRules = listAt(alertGroups[1], "rules");

function dashboardQueries(): Query[] {
  const queries: Query[] = [];
  for (const { file, board } of dashboards) {
    walk(board, (node) => {
      const datasource = isRecord(node.datasource) ? node.datasource.uid : undefined;
      if (typeof node.expr === "string" && datasource !== "loki" && typeof node.refId === "string") {
        queries.push({ source: `${file}: ${node.refId}`, expression: node.expr });
      }
    });
  }
  return queries;
}

function alertQueries(datasourceUid: string = PROMETHEUS): Query[] {
  return alertRules.flatMap((rule) =>
    listAt(rule, "data").flatMap((step) => {
      const model = recordAt(step, "model");
      return typeof model.expr === "string" && isRecord(step) && step.datasourceUid === datasourceUid ? [{ source: textAt(rule, "title"), expression: model.expr }] : [];
    }),
  );
}

function logQueries(): Query[] {
  const queries: Query[] = alertQueries(LOKI);
  for (const { file, board } of dashboards) {
    walk(board, (node) => {
      const datasource = isRecord(node.datasource) ? node.datasource.uid : undefined;
      if (typeof node.expr === "string" && datasource === LOKI && typeof node.refId === "string") {
        queries.push({ source: `${file}: ${node.refId}`, expression: node.expr });
      }
    });
  }
  return queries;
}

function panelTitles(board: unknown): string[] {
  return listAt(board, "panels").map((panel) => textAt(panel, "title"));
}

describe("the series the dashboards and alerts read", () => {
  const queries = [...dashboardQueries(), ...alertQueries()];

  it("finds the queries to check", () => {
    expect(queries.length).toBeGreaterThan(40);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s reads only known series", (_source, expression) => {
    const referenced = seriesIn(expression);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((series) => !KNOWN_SERIES.has(series))).toEqual([]);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s matches only labels its own series carries", (_source, expression) => {
    expect(selectorLabelsOutsideTheirSeries(expression)).toEqual([]);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s groups only by labels of the series it reads", (_source, expression) => {
    expect(groupingLabelsOutsideTheSeries(expression)).toEqual([]);
  });

  it("reads every series the six alerts need", () => {
    const alerted = alertQueries().flatMap((query) => seriesIn(query.expression));
    for (const series of [
      "questionnaire_submissions_total",
      "traces_span_metrics_calls_total",
      "traces_span_metrics_duration_milliseconds_bucket",
      "nodejs_eventloop_delay_p99_seconds",
      "db_pool_connections_waiting",
      "qp_monitor_response_partition_months_ahead",
    ]) {
      expect(alerted).toContain(series);
    }
  });
});

const LOG_STREAM_LABELS = ["service_name"];

const LOG_BUILT_IN_LABELS = ["detected_level"];

const STAMPED_ATTRIBUTES = ["module", "telemetry.source", "telemetry.event_age_ms", "trace_id", "span_id"];

function fieldNamesIn(block: string): string[] {
  return [...block.matchAll(/"(\w+)"/g)].map((match) => match[1] ?? "");
}

function attributeLabelOf(field: string): string {
  const entry = Object.entries(FIELDS).find(([name]) => name === field);
  if (entry === undefined) throw new Error(`wire-contract.ts lists "${field}", which is not a registry field`);
  return entry[1].attribute.replaceAll(".", "_");
}

const CLIENT_LINE_LABELS = [
  ...fieldNamesIn(/CLIENT_LOG_FIELDS = \[([^\]]*)\]/.exec(wireContractSource)?.[1] ?? ""),
  ...fieldNamesIn(/BROWSER_DOMAIN_FIELDS = \{([^}]*)\}/.exec(wireContractSource)?.[1] ?? ""),
].map(attributeLabelOf);

const INGEST_REASONS = [...(/INGEST_DROP_REASONS = \[([^\]]*)\]/.exec(vocabularySource)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((match) => match[1] ?? "");

const BROWSER_DOMAIN_EVENT_NAMES = [...(/BROWSER_DOMAIN_EVENTS = \[([^\]]*)\]/.exec(wireContractSource)?.[1] ?? "").matchAll(/"([\w.]+)"/g)].map((match) => match[1] ?? "");

const CLIENT_LOG_LINES = ["client.", ...CLIENT_LOG_LEVELS.map((level) => `client.${level}`), ...BROWSER_DOMAIN_EVENT_NAMES];

function matchersIn(expression: string): { label: string; operator: string; value: string }[] {
  return [...expression.matchAll(/([a-z_][a-z0-9_]*)\s*(=~|!~|!=|=)\s*"([^"]*)"/g)].map((match) => ({
    label: match[1] ?? "",
    operator: match[2] ?? "",
    value: match[3] ?? "",
  }));
}

function lineFiltersIn(expression: string): string[] {
  return [...expression.matchAll(/\|=\s*"([^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("the log queries the dashboards and alerts read", () => {
  const queries = logQueries();
  const allowedLabels = new Set([...LOG_STREAM_LABELS, ...LOG_BUILT_IN_LABELS, ...STAMPED_ATTRIBUTES.map((attribute) => attribute.replaceAll(".", "_")), ...CLIENT_LINE_LABELS]);

  it("finds the log queries to check, on the dashboards and in the alert rules", () => {
    expect(queries.length).toBeGreaterThan(8);
    expect(queries.some((query) => query.source.endsWith(".json: A"))).toBe(true);
    expect(alertQueries(LOKI).length).toBeGreaterThan(0);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s matches and groups only by labels a log line carries", (_source, expression) => {
    const grouped = [...expression.matchAll(/\bby\s*\(([^)]*)\)/g)].flatMap((match) => (match[1] ?? "").split(",").map((label) => label.trim()));

    expect(matchersIn(expression).map(({ label }) => label).filter((label) => !allowedLabels.has(label))).toEqual([]);
    expect(grouped.filter((label) => label !== "" && !allowedLabels.has(label))).toEqual([]);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s filters only on lines the ingest writes for a browser event", (_source, expression) => {
    expect(lineFiltersIn(expression).filter((line) => !CLIENT_LOG_LINES.includes(line))).toEqual([]);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s matches a level the logger has and a source the ingest stamps", (_source, expression) => {
    for (const { label, value } of matchersIn(expression)) {
      if (label === "detected_level") expect(value.split("|").filter((level) => !LOG_LEVELS.some((known) => known === level))).toEqual([]);
      if (label === "telemetry_source") expect(FIELDS.source.accepts(value), value).toBe(true);
    }
  });

  it("derives the labels a client line carries from the wire contract's field lists, not the whole registry", () => {
    expect(CLIENT_LINE_LABELS).toEqual(expect.arrayContaining(["error_type", "http_route", "questionnaire_last_item_id", "questionnaire_session_id", "questionnaire_duration_ms"]));
    expect(CLIENT_LINE_LABELS).not.toContain("http_response_status_code");
    expect(CLIENT_LINE_LABELS).not.toContain("questionnaire_outcome");
  });

  it("derives the client lines from the SDK and the wire contract", () => {
    expect(BROWSER_DOMAIN_EVENT_NAMES).toEqual(expect.arrayContaining(["session.abandoned", "page.loaded"]));
    expect(CLIENT_LOG_LINES).toEqual(expect.arrayContaining(["client.error", "client.warn", "client.info"]));
  });
});

describe("the Prometheus queries that read what the ingest drops", () => {
  it("match only reasons the ingest counts", () => {
    const reasons = [...dashboardQueries(), ...alertQueries()].flatMap((query) =>
      matchersIn(query.expression)
        .filter(({ label }) => label === "telemetry_ingest_reason")
        .flatMap(({ value }) => value.split("|")),
    );

    expect(INGEST_REASONS.length).toBeGreaterThan(0);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.filter((reason) => !INGEST_REASONS.includes(reason))).toEqual([]);
  });
});

describe("the dashboards", () => {
  it("are the five the design asks for, one file each", () => {
    expect(dashboards.map(({ board }) => textAt(board, "title")).sort()).toEqual(DASHBOARD_TITLES);
  });

  it("have unique uids, unique panel ids and a datasource the image provisions", () => {
    const uids = dashboards.map(({ board }) => textAt(board, "uid"));
    expect(new Set(uids).size).toBe(uids.length);
    for (const { file, board } of dashboards) {
      const ids = listAt(board, "panels").map((panel) => (isRecord(panel) ? panel.id : undefined));
      expect(new Set(ids).size, file).toBe(ids.length);
      walk(board, (node) => {
        if (isRecord(node.datasource)) expect(["prometheus", "loki"], file).toContain(node.datasource.uid);
      });
    }
  });

  it("give the database dashboard the panels the design lists", () => {
    const database = dashboards.find(({ board }) => textAt(board, "title") === "Database");
    const titles = panelTitles(database?.board);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Requests queued for a connection, by pool",
        "Query duration percentiles",
        "Partition runway",
        "Slowest statements",
      ]),
    );
    const slowest = listAt(database?.board, "panels").find((panel) => isRecord(panel) && panel.title === "Slowest statements");
    const content = textAt(recordAt(slowest, "options"), "content");
    expect(content).toContain("14.2");
    expect(content).toContain("listSessions");
  });

  it("give the client dashboard the panels the design lists, from the page load histogram, the ingest's drop counter and its log lines", () => {
    const client = dashboards.find(({ board }) => textAt(board, "title") === "Client");
    expect(panelTitles(client?.board)).toEqual(
      expect.arrayContaining([
        "Client errors",
        "Errors per page load",
        "Client events by level",
        "Page load duration percentiles",
        "Client errors by error type",
        "Client errors by screen",
        "Browser fields the ingest dropped",
        "Sessions abandoned, by last item",
        "Client warnings and errors, as logged",
        "What this dashboard cannot show",
      ]),
    );
    const expressions = dashboardQueries().filter((query) => query.source.startsWith(client?.file ?? "")).map((query) => query.expression).join("\n");
    expect(expressions).toContain("browser_page_load_duration_milliseconds_bucket");
    expect(expressions).toContain("telemetry_ingest_dropped_total");
  });

  it("keep the ingest's drop panel on the client dashboard and not on Service health", () => {
    const titlesOf = (name: string) => panelTitles(dashboards.find(({ board }) => textAt(board, "title") === name)?.board);
    expect(titlesOf("Client")).toContain("Browser fields the ingest dropped");
    expect(titlesOf("Service health")).not.toContain("Browser fields the ingest dropped");
  });

  it("group the client dashboard only by registry fields a browser cannot turn into free text", () => {
    const client = dashboards.find(({ board }) => textAt(board, "title") === "Client");
    const expressions = [...dashboardQueries(), ...logQueries()].filter((query) => query.source.startsWith(client?.file ?? "")).map((query) => query.expression);
    const grouped = new Set(expressions.flatMap((expression) => [...expression.matchAll(/\bby\s*\(([^)]*)\)/g)].flatMap((match) => (match[1] ?? "").split(",").map((label) => label.trim()))));
    grouped.delete("le");

    expect([...grouped].sort()).toEqual(["detected_level", "error_type", "http_route", "questionnaire_last_item_id", "telemetry_ingest_reason"]);
    for (const label of grouped) {
      if (label !== "detected_level") expect(ALLOWED_ATTRIBUTES.map((attribute) => attribute.replaceAll(".", "_")), label).toContain(label);
    }
  });

  it("chart the respondent funnel from the session counters", () => {
    const funnel = dashboards.find(({ board }) => textAt(board, "title") === "Respondent funnel");
    const expressions = dashboardQueries().filter((query) => query.source.startsWith(funnel?.file ?? "")).map((query) => query.expression).join("\n");
    for (const series of ["questionnaire_sessions_started_total", "questionnaire_sessions_completed_total", "questionnaire_sessions_abandoned_total"]) {
      expect(expressions).toContain(series);
    }
  });
});

describe("the alert rules", () => {
  it("are the six of O10 in one group and the client three in a second", () => {
    expect(alertGroups).toHaveLength(2);
    expect(listAt(alertGroups[0], "rules").map((rule) => textAt(rule, "title"))).toEqual(ALERT_TITLES);
    expect(clientRules.map((rule) => textAt(rule, "title"))).toEqual(CLIENT_ALERT_TITLES);
    expect(textAt(alertGroups[1], "name")).toBe("Questionnaire platform, client");
  });

  it.each(CLIENT_ALERT_TITLES)("the client rule %s only tickets, has a traffic floor and reads Prometheus or Loki", (title) => {
    const rule = clientRules.find((candidate) => isRecord(candidate) && candidate.title === title);
    const annotations = recordAt(rule, "annotations");
    for (const key of ["summary", "description", "first_look"]) expect(textAt(annotations, key).length, key).toBeGreaterThan(20);
    expect(textAt(recordAt(rule, "labels"), "severity")).toBe("ticket");
    expect(NO_DATA_STATES).toContain(textAt(rule, "noDataState"));
    expect(textAt(rule, "for")).toMatch(/^\d+m$/);
    expect([PROMETHEUS, LOKI]).toContain(textAt(listAt(rule, "data")[0], "datasourceUid"));
    expect(textAt(annotations, "description")).toMatch(/at least 20|threshold is the traffic floor/);
  });

  it.each(CLIENT_ALERT_TITLES)("the client rule %s has its traffic floor in the query or as its threshold, and not only in its prose", (title) => {
    const rule = clientRules.find((candidate) => isRecord(candidate) && candidate.title === title);
    const expression = textAt(recordAt(listAt(rule, "data")[0], "model"), "expr");
    const guard = /\band on\(\)\s*\(.*>=\s*(\d+)\)\s*$/.exec(expression)?.[1];
    const threshold = Number(listAt(recordAt(listAt(recordAt(listAt(rule, "data")[2], "model"), "conditions")[0], "evaluator"), "params")[0]);
    if (guard !== undefined) {
      expect(Number(guard)).toBeGreaterThanOrEqual(20);
    } else {
      expect(expression).toMatch(/^sum\(increase\(/);
      expect(threshold).toBeGreaterThanOrEqual(20);
    }
  });

  it.each(CLIENT_ALERT_TITLES)("the client rule %s names, for each dashboard it sends a person to, a panel that dashboard has", (title) => {
    const rule = clientRules.find((candidate) => isRecord(candidate) && candidate.title === title);
    const lookFirst = textAt(recordAt(rule, "annotations"), "first_look");
    const named = dashboards.filter(({ board }) => lookFirst.includes(`${textAt(board, "title")} dashboard`));
    expect(named.length).toBeGreaterThan(0);
    for (const { board } of named) expect(panelTitles(board).some((panel) => lookFirst.includes(panel)), textAt(board, "title")).toBe(true);
  });

  it("never page for what a browser reports, since client telemetry is unauthenticated and spoofable", () => {
    for (const rule of clientRules) expect(recordAt(rule, "labels").severity, textAt(rule, "title")).toBe("ticket");
    expect(alertRules.filter((rule) => isRecord(rule) && recordAt(rule, "labels").severity === "page")).toHaveLength(3);
  });

  it("read the series and log lines the client signals produce", () => {
    const prometheus = alertQueries().filter((query) => CLIENT_ALERT_TITLES.includes(query.source)).flatMap((query) => seriesIn(query.expression));
    for (const series of ["telemetry_ingest_dropped_total", "browser_page_load_duration_milliseconds_bucket", "browser_page_load_duration_milliseconds_count"]) {
      expect(prometheus).toContain(series);
    }
    const lines = alertQueries(LOKI).flatMap((query) => lineFiltersIn(query.expression));
    expect(lines).toEqual(expect.arrayContaining(["client.error", "page.loaded"]));
  });

  it.each(ALERT_TITLES)("%s is complete", (title) => {
    const rule = alertRules.find((candidate) => isRecord(candidate) && candidate.title === title);
    const annotations = recordAt(rule, "annotations");
    for (const key of ["summary", "description", "first_look"]) expect(textAt(annotations, key).length, key).toBeGreaterThan(20);
    expect(SEVERITIES).toContain(textAt(recordAt(rule, "labels"), "severity"));
    expect(NO_DATA_STATES).toContain(textAt(rule, "noDataState"));
    expect(textAt(rule, "for")).toMatch(/^\d+m$/);
    const steps = listAt(rule, "data").map((step) => textAt(step, "refId"));
    expect(steps).toContain(textAt(rule, "condition"));
    expect(textAt(listAt(rule, "data")[0], "datasourceUid")).toBe(PROMETHEUS);
    expect(alertRules.indexOf(rule)).toBeLessThan(ALERT_TITLES.length);
  });

  it("have unique uids no longer than Grafana allows", () => {
    const uids = alertRules.map((rule) => textAt(rule, "uid"));
    expect(new Set(uids).size).toBe(uids.length);
    for (const uid of uids) expect(uid.length).toBeLessThanOrEqual(40);
  });

  it("tell a person which dashboard and panel to open first", () => {
    for (const rule of alertRules) {
      const lookFirst = textAt(recordAt(rule, "annotations"), "first_look");
      const board = dashboards.find(({ board: candidate }) => lookFirst.includes(`${textAt(candidate, "title")} dashboard`));
      expect(board, textAt(rule, "title")).toBeDefined();
      expect(panelTitles(board?.board).some((title) => lookFirst.includes(title)), textAt(rule, "title")).toBe(true);
    }
  });

  it("page for what a respondent feels and ticket for causes", () => {
    const severityOf = (title: string): unknown => recordAt(alertRules.find((rule) => isRecord(rule) && rule.title === title), "labels").severity;
    expect(severityOf("Submit success rate drops")).toBe("page");
    expect(severityOf("5xx rate rises")).toBe("page");
    expect(severityOf("Fewer than one month of future response partitions remain")).toBe("page");
    expect(severityOf("p95 of the questionnaire definition fetch rises")).toBe("ticket");
    expect(severityOf("Event-loop lag stays high")).toBe("ticket");
    expect(severityOf("Requests stay queued for a pool connection")).toBe("ticket");
  });

  it("treat a silent partition monitor as a firing alert and every other silence as healthy", () => {
    const states = Object.fromEntries(alertRules.map((rule) => [textAt(rule, "title"), textAt(rule, "noDataState")]));
    expect(states["Fewer than one month of future response partitions remain"]).toBe("Alerting");
    for (const title of ALERT_TITLES.slice(0, 5)) expect(states[title], title).toBe("OK");
  });
});

describe("the Grafana provisioning mounts", () => {
  const lgtm = recordAt(recordAt(composeConfig, "services"), "lgtm");
  const mounts = listAt(lgtm, "volumes").map((volume) => String(volume));
  const provider = recordAt(listAt(parse(read(resolve(GRAFANA_DIRECTORY, "dashboards.yaml"))), "providers")[0], "options");

  it("are read-only", () => {
    expect(mounts.length).toBeGreaterThan(0);
    for (const mount of mounts) expect(mount.endsWith(":ro"), mount).toBe(true);
  });

  it("place the provider file and the alert rules beside the image's own provisioning, replacing none of it", () => {
    const targets = mounts.map((mount) => mount.split(":")[1] ?? "");
    expect(targets).toContain(`${PROVISIONING_DIRECTORY}/dashboards/qp-dashboards.yaml`);
    expect(targets).toContain(`${PROVISIONING_DIRECTORY}/alerting/qp-alert-rules.yaml`);
    for (const target of targets) expect(target.startsWith(PROVISIONING_DIRECTORY) ? /\.ya?ml$/.test(target) : true, target).toBe(true);
  });

  it("mount the dashboards directory where the provider reads it", () => {
    expect(mounts).toContain(`./observability/grafana/dashboards:${textAt(provider, "path")}:ro`);
  });

  it("mount the files this directory holds", () => {
    expect(mounts).toContain(`./observability/grafana/dashboards.yaml:${PROVISIONING_DIRECTORY}/dashboards/qp-dashboards.yaml:ro`);
    expect(mounts).toContain(`./observability/grafana/alert-rules.yaml:${PROVISIONING_DIRECTORY}/alerting/qp-alert-rules.yaml:ro`);
  });
});
