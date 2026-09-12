---
name: questionnaire-assignment
description: Requirements, review rubric, and design constraints for the Dynamic Questionnaire Platform interview assignment. Use whenever designing, implementing, testing, or documenting any part of this project so the work stays aligned with what the reviewers are looking for.
---

# Dynamic Questionnaire Platform — Assignment Skill

This project is a working, production-quality prototype of a dynamic questionnaire
platform. Use this skill as the source of truth for scope and quality bar. The full
brief lives in the attached Claude Project doc `Questionnaire_Platform_Interview_Assignment.docx`;
working docs are in `docs/` (see **Project docs** below).

## The one-line goal

An administrator can create and **version** questionnaires and questions, define
**conditional paths** based on prior responses, and a respondent can complete the
**correct flow** end to end. It must be runnable and demonstrable — not just a design.
Technology is free choice. Prefer a coherent vertical slice; document anything deferred.

## Required capabilities (checklist)

- [ ] Questionnaires: create, edit, view, **publish**, **retire**.
- [ ] Reusable questions with response types: text, single choice, multiple choice, number, date, yes/no.
- [ ] Versioning of questions AND questionnaires. A published version is **immutable**; historical responses keep the version they were collected against.
- [ ] Question ordering plus conditional branching rules that can depend on **one or more** previous responses.
- [ ] Respondent rendering that dynamically determines the next applicable question.
- [ ] Validation of required responses and response values.
- [ ] Persisted sessions and submitted responses; respondents can **resume** an incomplete session.
- [ ] Usable admin UI and usable respondent UI (simple is fine; the critical workflow must work end to end).
- [ ] A clear service/API boundary separating **questionnaire definition** (authoring/publishing) from **questionnaire execution** (sessions/responses).

## Mandatory branching demo

Ship a seeded questionnaire that does exactly this:

1. Ask whether the respondent has a medical condition (yes/no).
2. If **yes** → ask which condition, and when it was diagnosed (date).
3. If **no** → skip those and continue to the next common question.
4. Publish a **second version** that changes one question **without changing the meaning of responses already collected** under version one.

Automated tests should cover this scenario explicitly.

## Production-quality bar

- Clear domain model and DB schema with repeatable migrations / one-shot initialization.
- Well-defined APIs: input validation, useful error messages, consistent status handling.
- Automated tests on important domain behavior — **versioning and conditional navigation above all**.
- Separation of concerns: authoring, publishing, execution, response storage.
- Useful logging and enough operational visibility to troubleshoot a failed request or session.
- Reproducible local setup — ideally containers or a single command.

## Deliverables

1. Source code for the app and any supporting services.
2. README: setup, test commands, and steps to demo the primary workflow.
3. Concise architecture overview: major components, data model, request flow.
4. Record of key assumptions and design decisions, including alternatives considered and why they were rejected.
5. Short "what I'd improve next toward full production" section.

## Be ready to discuss (design defense)

- Versioning implementation and immutability guarantees for published questionnaires.
- Branching rule representation, validation, and execution — including **cycle and deadlock prevention**.
- What happens to **in-flight sessions when a questionnaire is republished**.
- Transaction management, concurrency control, and prototype tradeoffs.
- Future enhancements: multi-tenancy, security/HIPAA, localization, offline support.

## Scale considerations (answer concretely, not generically)

| Area | Must address |
| --- | --- |
| Read traffic | Keeping delivery + rule evaluation fast under high concurrency |
| Data growth | Indexing, partitioning, archiving a large response history |
| Reliability | Retries, duplicate submissions, partial failures, recovery |
| Change control | Schema migrations and releases that preserve published questionnaires and responses |
| Operations | First-priority metrics, logs, traces, alerts, backups, SLOs |

## Review rubric

Work is judged on: **working behavior** (end-to-end authoring → publishing → branching → response),
**engineering quality** (understandable, tested, maintainable, easy to run), **domain design**
(versioning, rules, sessions, responses modeled clearly), **decision quality** (explicit,
technically grounded tradeoffs), **production thinking** (security, reliability, observability,
deployment, change), and **communication** (can explain, demo, and handle alternative scenarios).

## Project docs (read these before making changes)

- [[2-design-doc]] — the design doc, filled in section by section. Decisions are recorded in the section they belong to **and** in [[2-design-doc#17. Decisions Log]] (with [[2-design-doc#17.1 Alternatives considered in detail]]). Italic prompts mark unfilled sections.
- [[3-scaling]] — scaling constraints, load model, and ordered levers (each with a trigger). Redis lives here, not in the prototype.
- [[4-implementation-plan]] — checkbox list of open decisions and build tasks; tick items as they land.
- [[1-ideation]] — original brainstorm; superseded where the design doc disagrees.

## Decisions made so far (don't relitigate without reason)

- **Stack:** React + TypeScript via Vite (plain SPA); Fastify on Node LTS; PostgreSQL via Drizzle ORM + `pg` driver, `drizzle-kit` SQL migrations; TypeScript throughout with a shared workspace package for API types and the rule engine.
- **Deployment:** separate `frontend` (nginx serving the build, reverse-proxying `/api` as a stand-in for a production ingress), `backend`, `migrate` (one-shot migrate + seed, gates backend) and `db` containers in Docker Compose. `docker-compose.override.yml` gives Vite HMR / `tsx watch` locally with polling file-watch enabled up front. Kubernetes long-term with the same split.
- **Auth:** out of scope; the access *model* and data barriers must still be written down.
- **Execution model:** client receives the whole published definition once per session and evaluates branching locally with the shared rule engine; partial answers live in the browser; the server keeps a small **session record** (pins the version, makes submit idempotent, shows where respondents abandon); submit is the single write; the **server recomputes the reachable path on submit and is the authority**. Optional debounced checkpoint endpoint is a scope call.
- **Versioning stance:** a session is pinned to a version at start and keeps it; new sessions get the latest published version; no client polling for updates.
- **Observability:** OpenTelemetry throughout; `@fastify/otel` on the backend; browser propagates trace context so frontend and backend logs correlate per session.
- **Not in prototype:** Redis (documented as separate cache and durable-queue levers), ingest queue, frontend split (respondent app vs. admin portal — listed as future work; keep them separate entry points/packages from the start).

## Still to decide (in dependency order)

1. Questionnaire format + versioning model (unit of versioning, what publish locks, draft → new version, the "change one question without changing meaning" demo).
2. Branching rule representation, evaluation, and publish-time validation (cycles, unreachable, deadlock).
3. Database schema (follows from 1–2).
4. API boundary: endpoint groups, error format, access model.
5. Sessions/responses: retirement policy for in-flight sessions, checkpoint scope, submit validation rules.
6. Overview/goals/constraints, observability, testing, Kubernetes subsection, [[2-design-doc#16. Scale & Growth]] table.

## Working conventions

- Talk through each decision one at a time; do not update docs until the user says so.
- When a decision lands: update the relevant design-doc section, add a Decisions Log row (alternatives + rationale + date), and expand [[2-design-doc#17.1 Alternatives considered in detail]] if the reasoning is non-trivial.
- Keep answers brief.

## Guiding principles when working on this repo

- Smaller-and-complete beats broad-and-unfinished. Never leave a critical path half done.
- Every shortcut, known risk, or omitted capability gets written down (decisions doc / README) so it can be discussed.
- Immutability of published versions is a hard invariant — enforce it in the data layer and tests, not just the UI.
- Keep definition and execution as distinct modules/services with an explicit boundary.
- When adding a feature, add the test for versioning/branching behavior first.
- AI coding agents are explicitly encouraged by the brief; keep this skill and project docs current so agents stay aligned.

