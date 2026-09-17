---
name: ci-failures
description: How to diagnose a red CI run on this repo — which job actually covers the failure, how to pull the real error out of a GitHub Actions log instead of the cleanup-step tail, why "Checks" can pass while "End-to-end" fails, and how to tell whether a failure is yours before touching anything. Use this whenever a check is red, a workflow run or job failed, a PR's CI is failing, or you are asked to root-cause, fix or investigate a CI failure — including "the e2e job is failing", "why is this check red", or "debug this GitHub Actions run" — before reading source to guess at a fix.
---

# Diagnosing a red CI run

This is the operational playbook for `.github/workflows/ci.yml`, distilled from actually chasing
down a red **End-to-end** job (PR 13, run 35258166191). Every line here either saved time or would
have if it had been written down first — it is not general CI advice.

## 1. The job layout — know which job can even see your bug

```
changes (Detect changes) ─┬─▶ checks (Checks: lint, typecheck, npm test, build)
                           └─▶ e2e (End-to-end: docker compose build+up via Testcontainers, then Playwright)
```

- **`changes`** diffs the PR's base..head. If every changed file ends in `.md`, both other jobs
  short-circuit to a one-line "skipping" step. One non-`.md` file in the diff and everything runs
  — don't assume a mostly-docs PR skipped CI without checking the diff yourself.
- **`checks`** runs entirely on the host runner: `npm ci`, `lint`, `typecheck`, `npm test` (this
  includes the backend's Vitest project against a **real Testcontainers Postgres** — the runner has
  Docker, so this passes there even though it can't run at all in a sandbox with no container
  runtime), `build`.
- **`e2e`** does `npm ci`, installs Playwright's Chromium, then `npm run test:e2e`, which is
  `npm run build -w @qp/shared && playwright test`. Playwright's `globalSetup`
  (`e2e/stack/global-setup.ts`) calls `startComposeStack`, which uses Testcontainers'
  `DockerComposeEnvironment(...).withBuild()` to **build `apps/backend/Dockerfile` and
  `deploy/frontend/Dockerfile` from scratch** and bring up the whole `docker-compose.yml` stack
  (db, roles, migrate, backend, frontend) before a single spec runs.

The load-bearing fact: **`checks` never touches either Dockerfile.** A change that's invisible to
`npm run lint && typecheck && test && build` on the host can still break `e2e`, because building the
images is a separate, only-in-CI code path. If `checks` is green and only `e2e` is red, look at the
Dockerfiles and `docker-compose.yml` before anything else, especially if your change touched a file
one of them names explicitly (see §4).

## 2. Getting at the actual failure

The tail of a job's log is post-job cleanup (`git config --unset`, safe-directory bookkeeping) —
it tells you nothing. Pull the log with `get_job_logs` (owner/repo/job_id from the failing job's
URL) and search it, don't eyeball the tail:

- Look for `##[error]` and the line just above it — that's usually `npm error command failed` with
  the actual command and exit code.
- If the tool response says the log exceeds the inline size limit, it saves the content to a file
  and tells you to read it in chunks. **Don't just `Read` it with default offsets** — a GitHub
  Actions log is one enormous line (timestamps mid-line), so `wc -l` reports `0` and `Read`'s
  line-based chunking is useless. Use Python or `grep -o` against the raw text instead; search for
  the specific signature you'd expect (`error TS`, `npm error`, `exit code`), not just "the error".

**For an `e2e` failure specifically, one thing does not show up in the log at all:** when
Testcontainers' `DockerComposeEnvironment` builds an image and the build fails, the log gives you
`target <service>: failed to solve: process "..." did not complete successfully: exit code: N` —
and *nothing else*. The failing `RUN` command's own stdout/stderr (the actual `tsc`/`npm` error) is
never forwarded through that path. Don't spend time hunting the log for it; it isn't there. You
have to reproduce the `RUN` step yourself (§3) to see what actually failed.

**The `playwright-report` artifact** is uploaded only `if: failure()`, and only helps for a failure
*inside a spec* (trace, screenshot, per-test error) — it's what you want for a flaky or broken test.
If the failure is in `globalSetup` (the stack never came up, as above), no spec ever ran and the
report has nothing in it; don't spend a download on it for that case. Also: `download_workflow_run_artifact`
only returns a presigned Azure Blob Storage URL, and in a sandboxed session that host is typically
not on the egress proxy's allowlist — a direct `curl` to it 403s at the proxy. That's a policy
denial, not a transient failure; don't retry it, fall back to the job log.

## 3. Reproducing without a container runtime

Many sandboxes have the `docker` CLI but no running daemon, and starting one (`dockerd`) is a
sandbox-level containment boundary — expect it to be denied outright, not just slow. Don't spend a
permission round-trip finding that out twice.

For a **Dockerfile build** failure (as opposed to a runtime/networking one), you don't need Docker
at all: replicate the failing stage's exact `COPY` lines into a scratch directory and run its `RUN`
command there.

```bash
mkdir -p /tmp/repro/packages/shared /tmp/repro/apps/backend
cp package.json package-lock.json tsconfig.base.json /tmp/repro/   # exactly what the Dockerfile COPYs
cp packages/shared/package.json /tmp/repro/packages/shared/
cp apps/backend/package.json /tmp/repro/apps/backend/
cd /tmp/repro && npm ci                                            # mirrors the deps stage
# then, mirroring the build stage's full-directory COPY + RUN:
cp -r <repo>/packages/shared /tmp/repro/packages/shared   # (replace the package.json-only copy)
cp -r <repo>/apps/backend /tmp/repro/apps/backend
npm run build -w packages/shared && npm run build -w apps/backend  # the Dockerfile's RUN, verbatim
```

This is a *faithful* repro of a build-context bug because it only has the files the Dockerfile
actually names — not your whole working tree — so a missing-file bug reproduces exactly (down to
the same `tsc` error code) and a fix is provable by rerunning it with the fix applied. It does not
cover anything that depends on the containers actually running and talking to each other
(environment variables, service DNS, healthchecks, migrations) — that class of bug genuinely needs
Docker, and if this environment has none, say so plainly rather than claiming you verified it.

## 4. "Is it mine?"

Before assuming a red job belongs to your branch:

1. **Rebase/merge `main` first.** A fix may already be in flight, and the diff you're debugging
   might not exist after merging.
2. **Check the same job on `main`.** `mcp__github__actions_list` (`list_workflow_runs`) filtered to
   `head_branch: main`, or `actions_get`/`get_workflow_run` on `main`'s latest CI run, tells you the
   job's conclusion there. If `main` is green at or after the commit your branch is based on, the
   failure is yours — own it, fix it, don't widen the PR to cover something else while you're in
   there. If `main` is also red, it predates your branch; say so and don't try to fix it inside an
   unrelated PR.
3. A change that's a pure rename/restructure (tsconfig presets, a moved file, a renamed script) is a
   prime suspect for exactly this kind of CI-only break: grep the **whole repo** for the old name or
   path, not just the file type you were nominally changing — `Dockerfile`s, `docker-compose.yml`,
   and `.github/workflows/*.yml` reference specific filenames by string, and none of them show up in
   a search scoped to `*.ts`/`tsconfig*.json`.

## 5. Traps that cost real time

- Treating the log tail as the failure. It's cleanup. Scroll to (or search for) the actual
  `##[error]` line.
- Expecting a Testcontainers-driven `docker compose build` failure to show the underlying tool's
  error text in the CI log. It doesn't — see §2. Reproduce the `RUN` step yourself instead of
  re-reading the log for something that isn't there.
- Trying to `curl` an artifact's presigned blob URL directly from a sandboxed session. It 403s at
  the egress proxy and retrying doesn't help — that's a policy boundary, not a flaky network.
- Trying to bring up a local Docker daemon to get a "real" repro. Denied immediately by the sandbox;
  go straight to the file-level repro in §3 instead of asking twice.
- Assuming `npm run lint && typecheck && test && build` passing locally means the PR is clean.
  It proves the host-side path is clean. It says nothing about a Dockerfile, `docker-compose.yml`,
  or a CI workflow file — none of them run under those four commands.
