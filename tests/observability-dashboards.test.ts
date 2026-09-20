import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_ATTRIBUTES } from "@qp/telemetry";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const GRAFANA_DIRECTORY = resolve(repoRoot, "observability/grafana");
const DASHBOARDS_DIRECTORY = resolve(GRAFANA_DIRECTORY, "dashboards");

const DASHBOARD_TITLES = ["Admin and authoring", "Database", "Respondent funnel", "Service health"];

const ALERT_TITLES = [
  "Submit success rate drops",
  "5xx rate rises",
  "p95 of the questionnaire definition fetch rises",
  "Event-loop lag stays high",
  "Requests stay queued for a pool connection",
  "Fewer than one month of future response partitions remain",
];

const SEVERITIES = ["page", "ticket"];

const NO_DATA_STATES = ["OK", "Alerting", "NoData"];

const PROMETHEUS = "prometheus";

const PROVISIONING_DIRECTORY = "/otel-lgtm/grafana/conf/provisioning";

const OUR_METRIC_PREFIX = /^(?:questionnaire|db|nodejs|traces|qp|telemetry|postgresql)_/;

type Kind = "counter" | "updown" | "gauge" | "histogram";

interface OtelMetric {
  readonly name: string;
  readonly kind: Kind;
  readonly unit: string;
}

const UNIT_SUFFIXES: Readonly<Record<string, string>> = { ms: "_milliseconds", s: "_seconds", By: "_bytes" };

const DATABASE_AND_RUNTIME_METRICS: readonly OtelMetric[] = [
  ...["total", "idle", "waiting"].map((state): OtelMetric => ({ name: `db.pool.connections.${state}`, kind: "gauge", unit: "{connection}" })),
  ...["min", "max", "mean", "stddev", "p50", "p90", "p99"].map((statistic): OtelMetric => ({ name: `nodejs.eventloop.delay.${statistic}`, kind: "gauge", unit: "s" })),
  { name: "nodejs.eventloop.utilization", kind: "gauge", unit: "1" },
  { name: "db.client.operation.duration", kind: "histogram", unit: "s" },
];

const POSTGRESQL_RECEIVER_METRICS: readonly OtelMetric[] = [
  { name: "postgresql.backends", kind: "updown", unit: "1" },
  { name: "postgresql.connection.max", kind: "gauge", unit: "{connections}" },
  { name: "postgresql.db_size", kind: "updown", unit: "By" },
  { name: "postgresql.commits", kind: "counter", unit: "1" },
  { name: "postgresql.rollbacks", kind: "counter", unit: "1" },
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

function applicationMetrics(): OtelMetric[] {
  const counters = [...eventsSource.matchAll(/>\(\s*"(questionnaire\.[a-z_.]+)"/g)].map((match) => match[1] ?? "");
  const scrubCounters = [...instrumentsSource.matchAll(/(?:DROPPED_COUNTER|INGEST_DROPPED_COUNTER) = "([^"]+)"/g)].map((match) => match[1] ?? "");
  const duration = /SESSION_DURATION = "([^"]+)"/.exec(instrumentsSource)?.[1] ?? "";
  const durationUnit = /createHistogram\(SESSION_DURATION, \{\s*unit: "([^"]+)"/.exec(instrumentsSource)?.[1] ?? "";
  return [
    ...[...counters, ...scrubCounters].map((name): OtelMetric => ({ name, kind: "counter", unit: "" })),
    { name: duration, kind: "histogram", unit: durationUnit },
  ];
}

function collectorMetrics(): OtelMetric[] {
  const spanMetrics = recordAt(recordAt(collectorConfig, "connectors"), "span_metrics");
  const namespace = textAt(spanMetrics, "namespace");
  const histogramUnit = textAt(recordAt(spanMetrics, "histogram"), "unit");
  const queries = listAt(recordAt(recordAt(collectorConfig, "receivers"), "sql_query/monitor"), "queries");
  const queried = queries.flatMap((query) =>
    listAt(query, "metrics").map((metric): OtelMetric => ({ name: textAt(metric, "metric_name"), kind: "gauge", unit: textAt(metric, "unit") })),
  );
  return [
    { name: `${namespace}.calls`, kind: "counter", unit: "" },
    { name: `${namespace}.duration`, kind: "histogram", unit: histogramUnit },
    ...queried,
  ];
}

function prometheusNames({ name, kind, unit }: OtelMetric): string[] {
  const base = name.replaceAll(".", "_");
  const unitSuffix = unit === "1" ? (kind === "gauge" ? "_ratio" : "") : (UNIT_SUFFIXES[unit] ?? "");
  const stem = `${base}${unitSuffix}`;
  if (kind === "counter") return [stem.endsWith("_total") ? stem : `${stem}_total`];
  if (kind === "histogram") return [`${stem}_bucket`, `${stem}_sum`, `${stem}_count`];
  return [stem];
}

const KNOWN_SERIES = new Set(
  [...applicationMetrics(), ...collectorMetrics(), ...DATABASE_AND_RUNTIME_METRICS, ...POSTGRESQL_RECEIVER_METRICS].flatMap(prometheusNames),
);

const SPAN_METRICS_LABELS = ["service_name", "span_name", "span_kind", "status_code", "le", "job", "instance"];

const KNOWN_LABELS = new Set([...ALLOWED_ATTRIBUTES.map((attribute) => attribute.replaceAll(".", "_")), ...SPAN_METRICS_LABELS]);

function seriesIn(expression: string): string[] {
  return [...expression.matchAll(/\b[a-z][a-z0-9_]*\b/g)].map((match) => match[0]).filter((token) => OUR_METRIC_PREFIX.test(token) && !KNOWN_LABELS.has(token));
}

function labelsIn(expression: string): string[] {
  const matched = [...expression.matchAll(/([a-z_][a-z0-9_]*)\s*(?:=~|!~|!=|=)\s*"/g)].map((match) => match[1] ?? "");
  const grouped = [...expression.matchAll(/\bby\s*\(([^)]*)\)/g)].flatMap((match) => (match[1] ?? "").split(",").map((label) => label.trim()));
  return [...matched, ...grouped].filter((label) => label !== "");
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

function alertQueries(): Query[] {
  return alertRules.flatMap((rule) =>
    listAt(rule, "data").flatMap((step) => {
      const model = recordAt(step, "model");
      return typeof model.expr === "string" ? [{ source: textAt(rule, "title"), expression: model.expr }] : [];
    }),
  );
}

function panelTitles(board: unknown): string[] {
  return listAt(board, "panels").map((panel) => textAt(panel, "title"));
}

describe("the series the dashboards and alerts read", () => {
  it("derives a series list from the Collector, the instruments and the D-stack names", () => {
    expect(KNOWN_SERIES.has("questionnaire_submissions_total")).toBe(true);
    expect(KNOWN_SERIES.has("questionnaire_session_duration_milliseconds_bucket")).toBe(true);
    expect(KNOWN_SERIES.has("traces_span_metrics_calls_total")).toBe(true);
    expect(KNOWN_SERIES.has("traces_span_metrics_duration_milliseconds_bucket")).toBe(true);
    expect(KNOWN_SERIES.has("qp_monitor_response_partition_months_ahead")).toBe(true);
    expect(KNOWN_SERIES.has("db_pool_connections_waiting")).toBe(true);
    expect(KNOWN_SERIES.has("nodejs_eventloop_delay_p99_seconds")).toBe(true);
    expect(KNOWN_SERIES.has("db_client_operation_duration_seconds_bucket")).toBe(true);
    expect(KNOWN_SERIES.has("questionnaire_publish_total")).toBe(true);
  });

  const queries = [...dashboardQueries(), ...alertQueries()];

  it("finds the queries to check", () => {
    expect(queries.length).toBeGreaterThan(40);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s reads only known series", (_source, expression) => {
    const referenced = seriesIn(expression);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((series) => !KNOWN_SERIES.has(series))).toEqual([]);
  });

  it.each(queries.map((query) => [query.source, query.expression] as const))("%s uses only labels the pipeline can carry", (_source, expression) => {
    expect(labelsIn(expression).filter((label) => !KNOWN_LABELS.has(label))).toEqual([]);
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

describe("the dashboards", () => {
  it("are the four the design asks for, one file each", () => {
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

  it("chart the respondent funnel from the session counters", () => {
    const funnel = dashboards.find(({ board }) => textAt(board, "title") === "Respondent funnel");
    const expressions = dashboardQueries().filter((query) => query.source.startsWith(funnel?.file ?? "")).map((query) => query.expression).join("\n");
    for (const series of ["questionnaire_sessions_started_total", "questionnaire_sessions_completed_total", "questionnaire_sessions_abandoned_total"]) {
      expect(expressions).toContain(series);
    }
  });
});

describe("the alert rules", () => {
  it("are the six of O10, in one group", () => {
    expect(alertGroups).toHaveLength(1);
    expect(alertRules.map((rule) => textAt(rule, "title"))).toEqual(ALERT_TITLES);
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
