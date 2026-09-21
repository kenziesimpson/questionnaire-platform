# Telemetry and the observability stack

Answers never enter telemetry: not a log, a span, a metric or an error body. The design is in
[`docs/6-observability.md`](../docs/6-observability.md), the package in [`packages/telemetry`](../packages/telemetry/README.md),
and the build status by pull request in the [implementation plan](../docs/4-implementation-plan.md#wave-3b--observability-and-pipeline).

What runs today:

- **Structured JSON logs** on the backend's stdout, one line per event, with the trace and span id inside a span; with export on, the same lines also leave as OpenTelemetry log records. `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) sets the threshold. Logs are pretty-printed when `NODE_ENV=development`.
- **Health probes:** `/health/live` (the process is up) and `/health/ready` (each database pool answers).
- **A closed field registry.** A log line or span carries only registered fields, whose types cannot hold free text; anything else is dropped and counted. `../.claude/skills/telemetry-safety/SKILL.md` says how to add a field or a signal.
- **The sentinel leak test**, which plants a value where an answer would be and fails if it reaches any log, span, metric or exported log record. Run it with `npm run test:leak-test`; CI runs it as its own job, "Response telemetry leak test".

OpenTelemetry export is off unless you point the backend at an OTLP/HTTP receiver. Set these in the backend's environment:

| Variable | Effect | Default |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL of the receiver. Traces go to `<endpoint>/v1/traces`, metrics to `<endpoint>/v1/metrics` and logs to `<endpoint>/v1/logs`, all through the scrub. Unset or empty: nothing is exported | unset |
| `OTEL_SERVICE_NAME` | The `service.name` on exported telemetry | `qp-backend` |
| `TELEMETRY_INGEST_EVENTS_PER_SECOND` | The cap on browser events the `/api/telemetry` ingest accepts each second, across every address, in one backend process. A quarter of it is kept for `session.abandoned` and `page.loaded`; events over it are answered `202` and shed, counted as `telemetry.ingest.dropped{reason=over_capacity}`. Compose passes it. A whole number of at least 2. Empty keeps the default | `200` |

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev:backend
```

## Run the observability stack

The `observability` Compose profile adds an OpenTelemetry Collector (`observability/collector.yaml`) and Grafana's `grafana/otel-lgtm`, which stores and shows traces, metrics and logs. It is opt-in: `docker compose up` starts none of it.

```bash
cp .env.example .env
# in .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
docker compose -f docker-compose.yml --profile observability up --build
```

- **Grafana:** http://localhost:3001 (the port is `GRAFANA_PORT`). It asks for no login. Explore has the traces, the request and database metrics, and the backend's logs.
- **Dashboards:** Dashboards, folder "Questionnaire platform": Service health, Respondent funnel, Admin and authoring, Database, Client, and Client page view (paste a client trace id from a log line to see one page view's requests). They are files under `observability/grafana/dashboards/`, so edit the JSON, not the UI.
- **Alerts:** Alerting, Alert rules, the group "Questionnaire platform, O10": the six alerts, and the group "Questionnaire platform, client": three that only ever ticket, each labelled `severity` `page` or `ticket` and annotated with what to look at first. No contact point is provisioned, so they show in Grafana and notify nobody until you add one under Alerting, Notification policies. Thresholds and reasoning are in [`docs/6-observability.md`](../docs/6-observability.md) §8.3.
- **Turning on export:** the backend sends nothing until `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Inside Compose it is `http://collector:4318`; for a backend on the host it is `http://localhost:4318` (the Collector publishes `OTLP_PORT` on `127.0.0.1`). Compose passes `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `LOG_LEVEL` and `TELEMETRY_INGEST_EVENTS_PER_SECOND` to the backend. Set `QP_SERVICE_VERSION` to a commit SHA to stamp each signal with the build; it defaults to `dev`. The plain `docker compose --profile observability up` (with the dev override) works too.
- **Browser correlation** is always on and needs no build option: the browser sends a `traceparent` on every request whose trace id is one random id per page load, kept in memory. The backend does not continue it: each request is a trace of its own, and the page's id is recorded as `client.trace_id` on the request span and `client_trace_id` on its log lines, so `{ span.client.trace_id = "<id>" }` in Tempo and `| client_trace_id="<id>"` in Loki find every request of one page view. The browser creates and exports no spans. H7 in [`docs/4-implementation-plan.md`](../docs/4-implementation-plan.md#manual-checkpoints) is the manual check that follows one submit and one admin read through the stack.
- **What the Collector keeps.** Every pipeline that exports has a redaction stage that removes every attribute not on its allowlist; the backend's signals use the telemetry field registry as the allowlist. The request-rate and latency metrics are derived from every span before sampling. Sampling, redaction and the log path are in [`docs/6-observability.md`](../docs/6-observability.md) §8.2, §10 and §11.
- **Logs** are emitted by the backend as OpenTelemetry log records, from the same place that writes its stdout lines and after the same scrub, and they carry the trace id of the request they belong to. The Collector reads no file and no container. **nginx's access log** is JSON on the frontend container's stdout (`docker compose logs frontend`): the method, the status, the trace context and the route with session ids masked as `:sessionId`, with a path that is not a plain route logged as `:unmatched` and no query string, so a pagination `cursor` cannot appear. It is not sent to Grafana ([`docs/6-observability.md`](../docs/6-observability.md) §11.1, L5).
- **Postgres metrics** are read as `qp_monitor`, a role that can read statistics and no answer table. The `roles` service creates it from `db/init/01-roles.sh` on every `up`.

### Sampling

The Collector keeps every trace that has an error, every trace longer than `QP_TRACE_SLOW_MS` (default 1000 ms), and `QP_TRACE_SAMPLE_PERCENT` percent of the rest (default 100). It ships at 100 because the prototype's volume is small; lower the percentage as volume grows, and errors and slow traces are still all kept. A health probe that succeeds quickly is never kept; one that fails or is slow is. Set both in `.env` (see `.env.example`); the design is in [`docs/6-observability.md`](../docs/6-observability.md) §10.

### Security

This profile is a single-machine local stack. Grafana runs with anonymous Admin access and the Collector's OTLP port has no authentication. Both are published on `127.0.0.1` only, which is the whole protection (O22). Do not bind either to another address, and do not use this configuration to host anything: a hosted stack needs authentication, TLS and a bind decided by the platform.

`lgtm` takes tens of seconds to accept OTLP and the Collector does not wait for it, so after a cold start the first exports are retried and some may be dropped.

CI builds the default stack but not this profile; a person running the command above is the check for the profile itself. The dashboards and alerts read Prometheus series named by the image's OTLP translation; CI checks them against the names the code produces, and Explore in Grafana confirms them (§11.2).
