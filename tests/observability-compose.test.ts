import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const OBSERVABILITY_PROFILE = "observability";

const OBSERVABILITY_SERVICES = ["collector", "lgtm"];

const LOOPBACK = "127.0.0.1";

const DOCKER_LOG_DIRECTORY = "/var/lib/docker/containers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(parent: unknown, key: string): Record<string, unknown> {
  const child = isRecord(parent) ? parent[key] : undefined;
  if (!isRecord(child)) throw new Error(`no mapping at "${key}"`);
  return child;
}

const composeDocument: unknown = parse(readFileSync(resolve(repoRoot, "docker-compose.yml"), "utf8"));
const services = recordAt(composeDocument, "services");
const backend = recordAt(services, "backend");
const collector = recordAt(services, "collector");

function stringsOf(service: unknown, key: string): string[] {
  const values = isRecord(service) ? service[key] : undefined;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

describe("the observability profile leaves the default stack as it was", () => {
  it("puts only the Collector and the store behind the profile", () => {
    const profiled = Object.entries(services)
      .filter(([, service]) => isRecord(service) && service.profiles !== undefined)
      .map(([name]) => name);
    expect(profiled).toEqual(OBSERVABILITY_SERVICES);
    for (const name of OBSERVABILITY_SERVICES) expect(recordAt(services, name).profiles).toEqual([OBSERVABILITY_PROFILE]);
  });

  it("starts the backend with no OTLP endpoint unless one is supplied", () => {
    expect(recordAt(backend, "environment").OTEL_EXPORTER_OTLP_ENDPOINT).toBe("${OTEL_EXPORTER_OTLP_ENDPOINT:-}");
  });

  it("gives the backend a healthcheck on /health/ready that needs no curl", () => {
    const test = recordAt(backend, "healthcheck").test;
    expect(test).toEqual(expect.arrayContaining(["CMD", "node"]));
    expect(JSON.stringify(test)).toContain("/health/ready");
    expect(JSON.stringify(test)).not.toContain("curl");
  });

  it("keeps the frontend's start condition as it was, since nginx resolves the backend's name at startup", () => {
    expect(recordAt(services, "frontend").depends_on).toEqual(["backend"]);
  });

  it("changes no service's log driver, labels or user: telemetry leaves the app through OTLP, not through Docker's log files", () => {
    for (const [name, service] of Object.entries(services)) {
      expect(recordAt({ service }, "service").logging, name).toBeUndefined();
      expect(recordAt({ service }, "service").labels, name).toBeUndefined();
    }
    expect(collector.user).toBeUndefined();
  });

  it("mounts no Docker log directory into any container", () => {
    for (const [name, service] of Object.entries(services)) {
      expect(stringsOf(service, "volumes").filter((volume) => volume.includes(DOCKER_LOG_DIRECTORY)), name).toEqual([]);
    }
  });
});

describe("the sampling knobs", () => {
  it("reach the Collector with the defaults the Collector config also carries", () => {
    const environment = recordAt(collector, "environment");
    expect(environment.QP_TRACE_SAMPLE_PERCENT).toBe("${QP_TRACE_SAMPLE_PERCENT:-100}");
    expect(environment.QP_TRACE_SLOW_MS).toBe("${QP_TRACE_SLOW_MS:-1000}");
  });
});

describe("the ports the observability profile publishes (O22)", () => {
  const published = OBSERVABILITY_SERVICES.flatMap((name) => stringsOf(recordAt(services, name), "ports").map((port) => [name, port] as const));

  it("finds the Collector's OTLP port and Grafana's", () => {
    expect(published.map(([name]) => name).sort()).toEqual(["collector", "lgtm"]);
  });

  it.each(published)("%s publishes %s on the loopback address only", (_name, port) => {
    expect(port.startsWith(`${LOOPBACK}:`)).toBe(true);
  });
});
