import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryApi } from "@qp/shared";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const nginxConfig = readFileSync(resolve(repoRoot, "deploy/frontend/nginx.conf"), "utf8");

interface Location {
  readonly matcher: string;
  readonly body: string;
}

const ZONE_LINE = /^limit_req_zone\s+(\$\w+)\s+zone=(\w+):(\d+)m\s+rate=(\d+)r\/([sm]);$/m;

function locations(source: string): Location[] {
  const found: Location[] = [];
  for (const start of source.matchAll(/^\s*location\s+([^{]+?)\s*\{/gm)) {
    const bodyStart = start.index + start[0].length;
    const bodyEnd = source.indexOf("}", bodyStart);
    found.push({ matcher: start[1] ?? "", body: source.slice(bodyStart, bodyEnd) });
  }
  return found;
}

function directive(body: string, name: string): string | undefined {
  return new RegExp(`^\\s*${name}\\s+(.+);$`, "m").exec(body)?.[1];
}

const INGEST_ONLY = [/^limit_req\s/, /^limit_req_status\s/, /^limit_req_log_level\s/];

function sharedDirectives(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !INGEST_ONLY.some((pattern) => pattern.test(line)))
    .sort();
}

function patternOf(matcher: string): RegExp {
  const pattern = /^~\s+(\S+)$/.exec(matcher)?.[1];
  if (pattern === undefined) throw new Error(`the telemetry location is not a regular expression location: ${matcher}`);
  return new RegExp(pattern);
}

const limited = locations(nginxConfig).filter((location) => /^\s*limit_req\s/m.test(location.body));

const zone = ZONE_LINE.exec(nginxConfig);

describe("nginx limits POST /api/telemetry per address and nothing else", () => {
  it("declares one zone at http context, keyed on the binary client address", () => {
    expect(zone).not.toBeNull();
    expect(zone?.[1]).toBe("$binary_remote_addr");
    const declared = nginxConfig.indexOf("limit_req_zone");
    expect(declared).toBeGreaterThan(-1);
    expect(declared).toBeLessThan(nginxConfig.indexOf("server {"));
    expect(nginxConfig.match(/limit_req_zone/g)).toHaveLength(1);
  });

  it("applies the zone in exactly one location, the ingest's, answering 429 with a burst and no delay", () => {
    expect(limited).toHaveLength(1);
    const [ingest] = limited;
    expect(ingest?.body).toMatch(new RegExp(`^\\s*limit_req\\s+zone=${zone?.[2]}\\s+burst=\\d+\\s+nodelay;$`, "m"));
    expect(directive(ingest?.body ?? "", "limit_req_status")).toBe("429");
  });

  it("matches the ingest path with and without a trailing slash and no other path", () => {
    const pattern = patternOf(limited[0]?.matcher ?? "");
    const prefix = telemetryApi.TELEMETRY_PREFIX;

    expect([prefix, `${prefix}/`].map((path) => pattern.test(path))).toEqual([true, true]);
    for (const other of [`${prefix}/other`, `${prefix}x`, `${prefix}//`, "/api/", "/api/run/sessions", "/api/reporting/questionnaires", "/admin/", "/", "/api"]) {
      expect(pattern.test(other), other).toBe(false);
    }
  });

  it("puts limit_req and limit_req_status nowhere else, so no other route is rate-limited", () => {
    const outside = locations(nginxConfig).reduce((source, location) => source.replace(location.body, ""), nginxConfig);

    expect(outside.match(/limit_req\b/g) ?? []).toEqual([]);
    expect(outside.match(/limit_req_status/g) ?? []).toEqual([]);
    expect(locations(nginxConfig).filter((location) => /limit_req_status/.test(location.body))).toHaveLength(1);
  });

  it("allows an address at least what the backend allows it and at most twice as much, so the backend answers first for a normal client", () => {
    const perMinute = Number(zone?.[4]) * (zone?.[5] === "s" ? 60 : 1);
    const burst = Number(/burst=(\d+)/.exec(limited[0]?.body ?? "")?.[1]);

    expect(perMinute).toBeGreaterThanOrEqual(telemetryApi.MAX_TELEMETRY_REQUESTS_PER_MINUTE);
    expect(perMinute + burst).toBeLessThanOrEqual(2 * telemetryApi.MAX_TELEMETRY_REQUESTS_PER_MINUTE);
  });

  it("carries every other directive of /api/, so the backend sees the same request as from the rest of /api/", () => {
    const api = locations(nginxConfig).find((location) => location.matcher === "/api/");

    expect(api).toBeDefined();
    expect(sharedDirectives(limited[0]?.body ?? "")).toEqual(sharedDirectives(api?.body ?? ""));
    expect(sharedDirectives(api?.body ?? "")).toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
  });
});
