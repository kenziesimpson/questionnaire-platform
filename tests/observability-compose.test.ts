import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const OBSERVABILITY_PROFILE = "observability";

const OBSERVABILITY_SERVICES = ["collector", "lgtm"];

const LOG_LABEL = "qp_log_service";

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
const collectorConfig = readFileSync(resolve(repoRoot, "observability/collector.yaml"), "utf8");
const backendConfig = readFileSync(resolve(repoRoot, "apps/backend/src/config.ts"), "utf8");

function volumesOf(service: unknown): string[] {
  const volumes = isRecord(service) ? service.volumes : undefined;
  return Array.isArray(volumes) ? volumes.filter((volume): volume is string => typeof volume === "string") : [];
}

function serviceNameDefault(reference: unknown): string | undefined {
  return typeof reference === "string" ? /^\$\{OTEL_SERVICE_NAME:-([^}]+)\}$/.exec(reference)?.[1] : undefined;
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
});

describe("the container logs the Collector reads", () => {
  it("are those of the containers that carry the label, and only the backend and the frontend do", () => {
    const labelled = Object.entries(services)
      .filter(([, service]) => isRecord(service) && isRecord(service.labels) && LOG_LABEL in service.labels)
      .map(([name]) => name);
    expect(labelled).toEqual(["backend", "frontend"]);
    for (const name of labelled) {
      expect(recordAt(recordAt(services, name), "logging")).toEqual({ driver: "json-file", options: { labels: LOG_LABEL } });
    }
    expect(recordAt(services, "db").labels).toBeUndefined();
    expect(recordAt(services, "db").logging).toBeUndefined();
  });

  it("are selected in the Collector by the same label", () => {
    expect(collectorConfig).toContain(`attributes.attrs.${LOG_LABEL} != nil`);
    expect(collectorConfig).toContain(`from: attributes.attrs.${LOG_LABEL}`);
  });

  it("are named for the service that the backend exports under, by default", () => {
    const labelled = serviceNameDefault(recordAt(backend, "labels")[LOG_LABEL]);
    const configured = /process\.env\.OTEL_SERVICE_NAME\) \?\? "([^"]+)"/.exec(backendConfig)?.[1];
    expect(labelled).toBeDefined();
    expect(labelled).toBe(configured);
  });

  it("are mounted read-only into the Collector and into no other container", () => {
    const mounting = Object.entries(services)
      .filter(([, service]) => volumesOf(service).some((volume) => volume.includes(DOCKER_LOG_DIRECTORY)))
      .map(([name]) => name);
    expect(mounting).toEqual(["collector"]);
    expect(volumesOf(recordAt(services, "collector"))).toContain(`${DOCKER_LOG_DIRECTORY}:${DOCKER_LOG_DIRECTORY}:ro`);
  });
});
