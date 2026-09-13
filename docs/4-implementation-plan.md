# Implementation Plan

> Checkbox list. Design thinking happens in [[2-design-doc]] / [[3-scaling]]; this file tracks what's decided and what's built. Keep in dependency order.

## Phase 0 — Think through (decisions still open)

- [x] **Questionnaire format** — question types and per-type constraints, flat-list structure & ordering, required-ness on the item, serialization with a worked example ([[2-design-doc#5. Questionnaire Format]])
- [x] **Branching rules** — typed per-type condition union, single level of `all` / `any`, absent-answer semantics, next-question evaluation, publish-time validation ([[2-design-doc#7. Branching Rules]])
- [x] **Definition storage split** — normalized authoring vs. JSONB published snapshot, publish as the seam, derived reverse-lookup index ([[2-design-doc#12. Database]] §12.1)
- [x] **Versioning model** — questionnaires (one draft, promotes in place, three-layer immutability, snapshot `formatVersion`), questions (append-only, no bank draft state, items pin the version at add time), and what a response stores ([[2-design-doc#6. Versioning & Immutability]])
- [x] **Database schema** — three schemas; draft-unreferenceable composite FKs; immutability triggers on `UPDATE` and `DELETE` plus a locking item guard; typed per-type `response` columns; monthly partitioning with no default partition; three row locks for concurrency; response immutability and audit append-only by grant ([[2-design-doc#12. Database]] §12.2, [[9-database-schema]])
- [x] **API boundary** — definition vs. execution as two encapsulated plugins, the published snapshot as the only artifact crossing, no unpinned definition read on the execution side, RFC 9457 errors and status conventions, access model and database-role barriers ([[2-design-doc#9. API / Service Boundary]], [[7-application-boundary]])
- [ ] **Sessions & responses** — **The next thing.** *retirement decided* (`closes_at`, hard cutoff); *submit validation and idempotency decided* (server re-evaluates the path, all-or-nothing, session-keyed digest). **Still open:** the checkpoint endpoint ([[2-design-doc#8. Sessions & Responses]], [[2-design-doc#18. Open Questions]] §6)
- [ ] The v2 demo change for the seeded questionnaire ([[2-design-doc#18. Open Questions]] §1)
- [ ] Observability details: log fields/levels, standard span attributes, collector setup local vs. hosted, first metrics/alerts/SLOs ([[2-design-doc#14. Observability]])
- [x] **Testing approach** — four layers, Fastify `inject()` for backend routes, Testcontainers Postgres with a template database per Vitest worker, Vitest + RTL components, three Playwright specs against the composed stack, one command via Vitest `projects`, two CI jobs ([[2-design-doc#15. Testing]], [[8-testing]])
- [ ] Overview, goals, constraints sections ([[2-design-doc#1. Overview]] §1–3)
- [ ] Kubernetes subsection ([[2-design-doc#13.2 Long-term (Kubernetes) — *to be filled in*]]) and [[2-design-doc#16. Scale & Growth]] scale table summarised from [[3-scaling]]

## Phase 1 — Plan the build

- [ ] Flesh out implementation order and details below once Phase 0 decisions land (repo layout, package boundaries, seed data, demo script, README outline)

## Phase 2 — Build

*(to be filled in from Phase 1)*

- [ ] **Enumerate test cases** — fill in [[8-testing#7. Test case enumeration]]: one row per case, grouped by the layers in [[8-testing#2. Layers]], each naming the invariant it defends and the [[8-testing#3. Required coverage — the graded list]] requirement it discharges. Written alongside each feature, not afterwards.
