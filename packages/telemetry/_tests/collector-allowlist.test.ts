import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ALLOWED_ATTRIBUTES } from "../src/fields.js";
import { LOG_MESSAGE_SHAPE } from "../src/vocabulary.js";

const COLLECTOR_CONFIG = fileURLToPath(new URL("../../../observability/collector.yaml", import.meta.url));

const ATTRIBUTES_ALLOWED_AHEAD_OF_THE_REGISTRY: readonly string[] = [];

const RESOURCE_KEYS_LEFT_UNFILTERED = ["service.name"];

const SAMPLING_POLICIES = ["errors", "slow", "baseline"];

const HEALTH_ROUTES = ["/health/ready", "/health/live"];

const POSTGRESQL_RECEIVER_ATTRIBUTES = [
  "db.collection.name",
  "db.namespace",
  "operation",
  "postgresql.database.name",
  "postgresql.index.name",
  "postgresql.schema.name",
  "postgresql.table.name",
  "replication_client",
  "server.address",
  "server.port",
  "service.instance.id",
  "source",
  "state",
  "type",
];

const KEYS_THAT_CAN_CARRY_A_VALUE = /query|statement|text|plan|(?:^|[._])sql(?:$|[._])|peer|user|application|lock|blocking|body|message|detail/i;

const SPAN_METRICS_FIXED_ATTRIBUTES = ["otel.status_code", "span.kind", "span.name", "status.code"];

const SAMPLE_PERCENT_VARIABLE = "QP_TRACE_SAMPLE_PERCENT";

const SLOW_MS_VARIABLE = "QP_TRACE_SLOW_MS";

const DEFAULT_SAMPLE_PERCENT = 100;

const DEFAULT_SLOW_MS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(parent: unknown, key: string): Record<string, unknown> {
  const child = isRecord(parent) ? parent[key] : undefined;
  if (!isRecord(child)) throw new Error(`the Collector config has no mapping at "${key}"`);
  return child;
}

function stringsAt(parent: unknown, key: string): string[] {
  const child = isRecord(parent) ? parent[key] : undefined;
  if (!Array.isArray(child) || !child.every((item): item is string => typeof item === "string")) {
    throw new Error(`the Collector config has no list of strings at "${key}"`);
  }
  return child;
}

function listAt(parent: unknown, key: string): unknown[] {
  const child = isRecord(parent) ? parent[key] : undefined;
  if (!Array.isArray(child)) throw new Error(`the Collector config has no list at "${key}"`);
  return child;
}

const collectorConfig: unknown = parse(readFileSync(COLLECTOR_CONFIG, "utf8"));
const processors = recordAt(collectorConfig, "processors");
const redaction = recordAt(processors, "redaction");
const pipelines = Object.entries(recordAt(recordAt(collectorConfig, "service"), "pipelines")).map(([name, pipeline]) => ({
  name,
  receivers: stringsAt(pipeline, "receivers"),
  processors: stringsAt(pipeline, "processors"),
  exporters: stringsAt(pipeline, "exporters"),
}));

function isRedaction(name: string): boolean {
  return name === "redaction" || name.startsWith("redaction/");
}

const connectors = Object.keys(recordAt(collectorConfig, "connectors"));

function isConnector(name: string): boolean {
  return connectors.includes(name);
}

function carriesApplicationData(receivers: readonly string[]): boolean {
  return receivers.some((receiver) => !isConnector(receiver));
}

describe("the Collector's redaction processor and the field registry", () => {
  it("keeps exactly the attributes the SDK's scrub can keep, plus any declared as expanded or contracting ahead of it", () => {
    const expected = [...ALLOWED_ATTRIBUTES, ...ATTRIBUTES_ALLOWED_AHEAD_OF_THE_REGISTRY].sort();
    expect(stringsAt(redaction, "allowed_keys")).toEqual(expected);
  });

  it("declares no attribute ahead of the registry that the registry already has", () => {
    expect(ATTRIBUTES_ALLOWED_AHEAD_OF_THE_REGISTRY.filter((attribute) => ALLOWED_ATTRIBUTES.includes(attribute))).toEqual([]);
  });

  it("leaves unfiltered only the resource keys the Collector needs to route a signal", () => {
    expect(stringsAt(redaction, "ignored_keys")).toEqual(RESOURCE_KEYS_LEFT_UNFILTERED);
    expect(ALLOWED_ATTRIBUTES).not.toContain("service.name");
  });
});

describe("every redaction stage", () => {
  const stages = Object.entries(processors).filter(([name]) => isRedaction(name));

  it("finds the stages", () => {
    expect(stages.map(([name]) => name).sort()).toEqual(["redaction", "redaction/derived", "redaction/monitor", "redaction/postgresql"]);
  });

  it.each(stages)("%s fails closed: no allow-all switch, no key pattern, no value rule and no diagnostic attribute", (_name, stage) => {
    expect(recordAt({ stage }, "stage").allow_all_keys).toBe(false);
    for (const key of ["ignored_key_patterns", "blocked_key_patterns", "blocked_values", "allowed_values", "url_sanitizer", "db_sanitizer"]) {
      expect(recordAt({ stage }, "stage")[key], key).toBeUndefined();
    }
    expect(recordAt({ stage }, "stage").summary).toBe("silent");
  });

  it.each(stages)("%s lists no key more than once", (_name, stage) => {
    const keys = stringsAt(stage, "allowed_keys");
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the Collector's pipelines", () => {
  const applicationPipelines = pipelines.filter(({ receivers }) => carriesApplicationData(receivers));
  const exporting = pipelines.filter(({ exporters }) => exporters.some((exporter) => !isConnector(exporter)));

  it("finds the pipelines that receive application data and the ones that export", () => {
    expect(applicationPipelines.map(({ name }) => name).sort()).toEqual([
      "logs/application",
      "metrics/application",
      "metrics/monitor",
      "metrics/postgresql",
      "traces/ingest",
    ]);
    expect(exporting.map(({ name }) => name).sort()).toEqual([
      "logs/application",
      "metrics/application",
      "metrics/derived",
      "metrics/monitor",
      "metrics/postgresql",
      "traces/sampled",
    ]);
  });

  it.each(exporting.map(({ name, processors: steps }) => [name, steps] as const))("%s has a redaction stage before it exports", (_name, steps) => {
    expect(steps.some(isRedaction)).toBe(true);
  });

  it.each(exporting.map(({ name, processors: steps }) => [name, steps] as const))("%s stamps the build after its redaction", (_name, steps) => {
    expect(steps).toContain("resource/build");
    expect(steps.indexOf("resource/build")).toBeGreaterThan(steps.findIndex(isRedaction));
  });

  it.each(applicationPipelines.map(({ name, processors: steps }) => [name, steps] as const))(
    "%s filters attributes before any other processor but the memory limiter",
    (_name, steps) => {
      expect(isRedaction(steps.filter((step) => step !== "memory_limiter")[0] ?? "")).toBe(true);
    },
  );

  it("counts every trace before any is sampled away", () => {
    const sampling = pipelines.filter(({ processors: steps }) => steps.includes("tail_sampling"));
    expect(sampling.map(({ name }) => name)).toEqual(["traces/sampled"]);
    expect(sampling.every(({ receivers }) => receivers.every((receiver) => receiver.startsWith("forward/")))).toBe(true);
    const counting = pipelines.filter(({ exporters }) => exporters.includes("span_metrics"));
    expect(counting.map(({ name }) => name)).toEqual(["traces/spanmetrics"]);
    expect(counting.some(({ processors: steps }) => steps.includes("tail_sampling"))).toBe(false);
  });

  it("derives the request metrics from the dimensions the registry allows", () => {
    const dimensions = recordAt(collectorConfig, "connectors").span_metrics;
    const named = isRecord(dimensions) && Array.isArray(dimensions.dimensions) ? dimensions.dimensions : [];
    const names = named.flatMap((dimension) => (isRecord(dimension) && typeof dimension.name === "string" ? [dimension.name] : []));
    expect(names).toEqual(["http.route", "http.request.method", "http.response.status_code"]);
    for (const name of names) expect(ALLOWED_ATTRIBUTES).toContain(name);
  });

  it("reads no container log file: the Collector has no file receiver and no log operator", () => {
    const receivers = Object.keys(recordAt(collectorConfig, "receivers"));
    expect(receivers.filter((name) => name.startsWith("file"))).toEqual([]);
  });
});

describe("the metrics the Collector generates", () => {
  it("keep the span-metrics dimensions and the connector's fixed attributes, and nothing else", () => {
    const spanMetrics = recordAt(recordAt(collectorConfig, "connectors"), "span_metrics");
    const dimensions = listAt(spanMetrics, "dimensions").map((dimension) => (isRecord(dimension) ? String(dimension.name) : ""));
    const derived = stringsAt(recordAt(processors, "redaction/derived"), "allowed_keys");
    expect(derived).toEqual([...dimensions, ...SPAN_METRICS_FIXED_ATTRIBUTES].sort());
  });

  it("keep, of the Postgres receiver, exactly the attributes of its default-enabled metrics and resource", () => {
    expect(stringsAt(recordAt(processors, "redaction/postgresql"), "allowed_keys")).toEqual([...POSTGRESQL_RECEIVER_ATTRIBUTES].sort());
  });

  it("allow no Postgres attribute that could carry statement text or a value", () => {
    const allowed = stringsAt(recordAt(processors, "redaction/postgresql"), "allowed_keys");
    expect(allowed.filter((key) => KEYS_THAT_CAN_CARRY_A_VALUE.test(key))).toEqual([]);
    expect(allowed.filter((key) => ALLOWED_ATTRIBUTES.includes(key) && key.startsWith("questionnaire"))).toEqual([]);
  });

  it("allow the partition gauge no attribute, since a monitor query has no column an attribute could come from", () => {
    expect(stringsAt(recordAt(processors, "redaction/monitor"), "allowed_keys")).toEqual([]);
    const receiver = recordAt(recordAt(collectorConfig, "receivers"), "sql_query/monitor");
    const columns = listAt(receiver, "queries").flatMap((query) => (isRecord(query) ? [query.attribute_columns, query.tracking_column] : []));
    expect(columns.filter((column) => column !== undefined)).toEqual([]);
    expect(listAt(receiver, "queries")).toHaveLength(1);
  });

  it("leave the Postgres receiver's query-sample and top-query events, which carry statement text, disabled", () => {
    const receiver = recordAt(recordAt(collectorConfig, "receivers"), "postgresql");
    const events = isRecord(receiver.events) ? Object.entries(receiver.events) : [];
    for (const [name, event] of events) expect(isRecord(event) && event.enabled === true, name).toBe(false);
    for (const key of Object.keys(receiver)) expect(key, "a receiver option").not.toMatch(/query_sample|top_query|query_plan/i);
  });
});

describe("the log records the Collector accepts", () => {
  it("are dropped unless their body has the literal-message shape the SDK's log exporter enforces", () => {
    const conditions = stringsAt(recordAt(processors, "filter/log_bodies"), "log_conditions");
    expect(conditions).toHaveLength(1);
    const shape = /IsMatch\(log\.body\.string, "(.+)"\)/.exec(conditions[0] ?? "")?.[1];
    expect(shape).toBe(LOG_MESSAGE_SHAPE.source.replaceAll("\\/", "/"));
    expect(conditions[0]?.startsWith("not ")).toBe(true);
  });

  it("are filtered after their attributes are", () => {
    const logs = pipelines.find(({ name }) => name === "logs/application");
    const steps = logs?.processors ?? [];
    expect(steps.indexOf("filter/log_bodies")).toBeGreaterThan(steps.indexOf("redaction"));
  });
});

interface SampledSpan {
  readonly route: string | undefined;
  readonly error: boolean;
  readonly startMs: number;
  readonly endMs: number;
}

function resolvedNumber(value: unknown, environment: Readonly<Record<string, number>>): number {
  if (typeof value === "number") return value;
  const reference = typeof value === "string" ? /^\$\{env:([A-Z_]+):-(\d+)\}$/.exec(value) : null;
  if (reference === null) throw new Error(`"${String(value)}" is neither a number nor an environment reference with a numeric default`);
  return environment[reference[1] ?? ""] ?? Number(reference[2]);
}

function policyKeeps(policy: unknown, spans: readonly SampledSpan[], environment: Readonly<Record<string, number>>): boolean {
  const type = isRecord(policy) ? policy.type : undefined;
  if (type === "status_code") return spans.some((span) => span.error);
  if (type === "latency") {
    const duration = Math.max(...spans.map((span) => span.endMs)) - Math.min(...spans.map((span) => span.startMs));
    return duration > resolvedNumber(recordAt(policy, "latency").threshold_ms, environment);
  }
  if (type === "probabilistic") return resolvedNumber(recordAt(policy, "probabilistic").sampling_percentage, environment) >= 100;
  if (type === "string_attribute") {
    const attribute = recordAt(policy, "string_attribute");
    const matches = spans.some((span) => span.route !== undefined && stringsAt(attribute, "values").includes(span.route));
    return attribute.invert_match === true ? !matches : matches;
  }
  if (type === "and") return listAt(recordAt(policy, "and"), "and_sub_policy").every((sub) => policyKeeps(sub, spans, environment));
  throw new Error(`the sampling test does not know the policy type ${String(type)}`);
}

function traceIsKept(spans: readonly SampledSpan[], environment: Readonly<Record<string, number>> = {}): boolean {
  const policies = listAt(recordAt(processors, "tail_sampling"), "policies");
  return policies.some((policy) => policyKeeps(policy, spans, environment));
}

function trace(route: string | undefined, options: { readonly error?: boolean; readonly durationMs?: number } = {}): SampledSpan[] {
  return [
    { route, error: options.error ?? false, startMs: 0, endMs: options.durationMs ?? 20 },
    { route: undefined, error: false, startMs: 2, endMs: 10 },
  ];
}

describe("the Collector's tail sampling", () => {
  const policies = listAt(recordAt(processors, "tail_sampling"), "policies");

  it("has an errors policy, a slow policy and a baseline, and nothing else", () => {
    expect(policies.map((policy) => (isRecord(policy) ? policy.name : undefined))).toEqual(SAMPLING_POLICIES);
    expect(recordAt(policies[0], "status_code").status_codes).toEqual(["ERROR"]);
  });

  it("takes the slow threshold and the baseline share from the environment, and ships at 100% and one second", () => {
    expect(recordAt(policies[1], "latency").threshold_ms).toBe(`\${env:${SLOW_MS_VARIABLE}:-${DEFAULT_SLOW_MS}}`);
    const baseline = listAt(recordAt(policies[2], "and"), "and_sub_policy");
    expect(recordAt(baseline[0], "probabilistic").sampling_percentage).toBe(`\${env:${SAMPLE_PERCENT_VARIABLE}:-${DEFAULT_SAMPLE_PERCENT}}`);
    expect(resolvedNumber(recordAt(baseline[0], "probabilistic").sampling_percentage, {})).toBe(100);
    expect(resolvedNumber(recordAt(policies[1], "latency").threshold_ms, {})).toBe(1000);
  });

  it("restricts only the baseline to traces with no health probe span, so a probe can be kept only for being slow or failing", () => {
    const baseline = listAt(recordAt(policies[2], "and"), "and_sub_policy");
    const notAProbe = recordAt(baseline[1], "string_attribute");
    expect(baseline).toHaveLength(2);
    expect(notAProbe.key).toBe("http.route");
    expect(notAProbe.invert_match).toBe(true);
    expect(stringsAt(notAProbe, "values")).toEqual(HEALTH_ROUTES);
    expect(JSON.stringify(policies[0])).not.toContain("http.route");
    expect(JSON.stringify(policies[1])).not.toContain("http.route");
  });

  it("has no drop policy, which would override the errors and slow policies", () => {
    expect(policies.map((policy) => (isRecord(policy) ? policy.type : undefined))).not.toContain("drop");
  });

  it.each(HEALTH_ROUTES)("drops a successful, quick trace of %s", (route) => {
    expect(traceIsKept(trace(route))).toBe(false);
  });

  it.each(HEALTH_ROUTES)("keeps a failing trace of %s", (route) => {
    expect(traceIsKept(trace(route, { error: true }))).toBe(true);
  });

  it.each(HEALTH_ROUTES)("keeps a slow trace of %s", (route) => {
    expect(traceIsKept(trace(route, { durationMs: DEFAULT_SLOW_MS + 500 }))).toBe(true);
  });

  it("keeps an ordinary trace at the default share", () => {
    expect(traceIsKept(trace("/api/run/sessions/:sessionId"))).toBe(true);
  });

  it("keeps only the errors and the slow traces once the share is zero", () => {
    const none = { [SAMPLE_PERCENT_VARIABLE]: 0 };
    expect(traceIsKept(trace("/api/run/sessions"), none)).toBe(false);
    expect(traceIsKept(trace("/api/run/sessions", { error: true }), none)).toBe(true);
    expect(traceIsKept(trace("/api/run/sessions", { durationMs: DEFAULT_SLOW_MS + 500 }), none)).toBe(true);
  });

  it("moves the slow line with the environment", () => {
    const none = { [SAMPLE_PERCENT_VARIABLE]: 0 };
    expect(traceIsKept(trace("/api/run/sessions", { durationMs: 400 }), { ...none, [SLOW_MS_VARIABLE]: 300 })).toBe(true);
    expect(traceIsKept(trace("/api/run/sessions", { durationMs: 400 }), none)).toBe(false);
  });
});

describe("the request metrics", () => {
  const conditions = stringsAt(recordAt(processors, "filter/counted_requests"), "trace_conditions");

  it("leave out health probes and every span that is not a server span", () => {
    expect(conditions).toContain("span.kind != SPAN_KIND_SERVER");
    for (const route of HEALTH_ROUTES) expect(conditions).toContain(`span.attributes["http.route"] == "${route}"`);
  });

  it("read the spans through that filter", () => {
    const counting = pipelines.filter(({ exporters }) => exporters.includes("span_metrics"));
    expect(counting.map(({ processors: steps }) => steps)).toEqual([["filter/counted_requests"]]);
  });
});
