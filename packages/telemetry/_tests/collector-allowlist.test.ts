import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ALLOWED_ATTRIBUTES } from "../src/fields.js";

const COLLECTOR_CONFIG = fileURLToPath(new URL("../../../observability/collector.yaml", import.meta.url));

const APPLICATION_DATA_RECEIVERS = ["otlp", "file_log"];

const ATTRIBUTES_ALLOWED_AHEAD_OF_THE_REGISTRY: readonly string[] = [];

const RESOURCE_KEYS_LEFT_UNFILTERED = ["service.name"];

const SAMPLING_POLICIES = ["errors", "slow", "baseline", "health_probes"];

const HEALTH_ROUTES = ["/health/ready", "/health/live"];

const NGINX_CONFIG = fileURLToPath(new URL("../../../deploy/frontend/nginx.conf", import.meta.url));

const LOG_RECEIVER = "file_log/containers";

const BASELINE_PERCENTAGE = 10;

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

const collectorConfig: unknown = parse(readFileSync(COLLECTOR_CONFIG, "utf8"));
const processors = recordAt(collectorConfig, "processors");
const redaction = recordAt(processors, "redaction");
const pipelines = Object.entries(recordAt(recordAt(collectorConfig, "service"), "pipelines")).map(([name, pipeline]) => ({
  name,
  receivers: stringsAt(pipeline, "receivers"),
  processors: stringsAt(pipeline, "processors"),
  exporters: stringsAt(pipeline, "exporters"),
}));

function carriesApplicationData(receivers: readonly string[]): boolean {
  return receivers.some((receiver) => APPLICATION_DATA_RECEIVERS.includes(receiver.split("/")[0] ?? receiver));
}

describe("the Collector's redaction processor and the field registry", () => {
  it("keeps exactly the attributes the SDK's scrub can keep, plus any declared as expanded or contracting ahead of it", () => {
    const expected = [...ALLOWED_ATTRIBUTES, ...ATTRIBUTES_ALLOWED_AHEAD_OF_THE_REGISTRY].sort();
    expect(stringsAt(redaction, "allowed_keys")).toEqual(expected);
  });

  it("declares no attribute ahead of the registry that the registry already has", () => {
    expect(ATTRIBUTES_ALLOWED_AHEAD_OF_THE_REGISTRY.filter((attribute) => ALLOWED_ATTRIBUTES.includes(attribute))).toEqual([]);
  });

  it("fails closed: it has no allow-all switch and no key pattern", () => {
    expect(redaction.allow_all_keys).toBe(false);
    expect(redaction.ignored_key_patterns).toBeUndefined();
    expect(redaction.blocked_key_patterns).toBeUndefined();
  });

  it("leaves unfiltered only the resource keys the Collector needs to route a signal", () => {
    expect(stringsAt(redaction, "ignored_keys")).toEqual(RESOURCE_KEYS_LEFT_UNFILTERED);
    expect(ALLOWED_ATTRIBUTES).not.toContain("service.name");
  });

  it("adds no diagnostic attribute to the records it filters", () => {
    expect(redaction.summary).toBe("silent");
  });
});

describe("the Collector's pipelines", () => {
  const applicationPipelines = pipelines.filter(({ receivers }) => carriesApplicationData(receivers));

  it("finds the pipelines that carry application data", () => {
    expect(applicationPipelines.map(({ name }) => name).sort()).toEqual(["logs/containers", "metrics/application", "traces/ingest"]);
  });

  it.each(applicationPipelines.map(({ name, processors: steps }) => [name, steps] as const))(
    "%s filters attributes before any other processor but the memory limiter",
    (_name, steps) => {
      expect(steps.filter((step) => step !== "memory_limiter")[0]).toBe("redaction");
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
});

describe("the Collector's tail sampling", () => {
  const samplingPolicies = recordAt(processors, "tail_sampling").policies;
  const policies = Array.isArray(samplingPolicies) ? samplingPolicies.filter(isRecord) : [];

  it("keeps errors, slow traces and a fixed share of the rest, and nothing else", () => {
    expect(policies.map((policy) => policy.name)).toEqual(SAMPLING_POLICIES);
    expect(recordAt(policies[0], "status_code").status_codes).toEqual(["ERROR"]);
    expect(recordAt(policies[1], "latency").threshold_ms).toEqual(expect.any(Number));
    expect(recordAt(policies[2], "probabilistic").sampling_percentage).toBe(BASELINE_PERCENTAGE);
  });

  it("drops a trace that touches a health probe route, and only those routes", () => {
    const subPolicies = recordAt(policies[3], "drop").drop_sub_policy;
    const dropping = Array.isArray(subPolicies) ? subPolicies : [];
    expect(dropping).toHaveLength(1);
    const attribute = recordAt(dropping[0], "string_attribute");
    expect(attribute.key).toBe("http.route");
    expect(stringsAt(attribute, "values")).toEqual(HEALTH_ROUTES);
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

describe("the build stamp", () => {
  it("is on every pipeline that exports to the store, after any redaction", () => {
    const exporting = pipelines.filter(({ exporters }) => exporters.includes("otlp_http/lgtm"));
    expect(exporting.length).toBeGreaterThan(0);
    for (const { name, processors: steps } of exporting) {
      expect(steps, name).toContain("resource/build");
      if (steps.includes("redaction")) expect(steps.indexOf("resource/build"), name).toBeGreaterThan(steps.indexOf("redaction"));
    }
  });
});

describe("the nginx access log line and the Collector's log operators", () => {
  const nginx = readFileSync(NGINX_CONFIG, "utf8");
  const logFormat = /log_format telemetry escape=json((?:\s+'[^']*')+);/.exec(nginx)?.[1] ?? "";
  const line = [...logFormat.matchAll(/'([^']*)'/g)]
    .map((piece) => piece[1] ?? "")
    .join("")
    .replaceAll("$request_method", "GET")
    .replaceAll("$logged_route", "/api/run/sessions/:sessionId")
    .replaceAll("$logged_status", "200")
    .replaceAll("$logged_trace_id", "")
    .replaceAll("$logged_span_id", "");
  const record: unknown = JSON.parse(line);
  const operators = recordAt(collectorConfig, "receivers")[LOG_RECEIVER];
  const steps = isRecord(operators) && Array.isArray(operators.operators) ? operators.operators.filter(isRecord) : [];

  function step(id: string): Record<string, unknown> {
    const found = steps.find((operator) => operator.id === id);
    if (found === undefined) throw new Error(`the log receiver has no operator "${id}"`);
    return found;
  }

  it("is a JSON object whose only key outside the registry is the message", () => {
    expect(isRecord(record)).toBe(true);
    const keys = isRecord(record) ? Object.keys(record) : [];
    expect(keys.filter((key) => key !== "msg").filter((key) => !ALLOWED_ATTRIBUTES.includes(key))).toEqual([]);
    expect(line.startsWith("{")).toBe(true);
  });

  it("has a message the Collector's message filter accepts", () => {
    const expression = step("only_literal_messages").expr;
    const shape = typeof expression === "string" ? /matches "(.+)"\)$/.exec(expression)?.[1] : undefined;
    expect(shape).toBeDefined();
    expect(new RegExp(shape ?? "$^").test(String(isRecord(record) ? record.msg : ""))).toBe(true);
  });

  it("has no level, so severity is parsed apart from the JSON and only when the level is present", () => {
    expect(isRecord(record) && "level" in record).toBe(false);
    expect(step("application_line").severity).toBeUndefined();
    expect(step("severity_from_level").type).toBe("severity_parser");
    expect(step("severity_from_level").if).toBe("attributes.level != nil");
  });

  it("drops a line on a parse error rather than exporting it as text", () => {
    expect(step("application_line").on_error).toBe("drop");
    expect(step("docker_line").on_error).toBe("drop");
  });
});
