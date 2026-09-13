# Implementation Plan

> Checkbox list. Design thinking happens in [[2-design-doc]] / [[3-scaling]]; this file tracks what's decided and what's built. Keep in dependency order.

## Phase 0 — Think through (decisions still open)

- [x] **Questionnaire format** — question types and per-type constraints, flat-list structure & ordering, required-ness on the item, serialization with a worked example ([[2-design-doc#5. Questionnaire Format]])
- [x] **Branching rules** — typed per-type condition union, single level of `all` / `any`, absent-answer semantics, next-question evaluation, publish-time validation ([[2-design-doc#7. Branching Rules]])
- [x] **Definition storage split** — normalized authoring vs. JSONB published snapshot, publish as the seam, derived reverse-lookup index ([[2-design-doc#12. Database]] §12.1)
- [x] **Versioning model** — questionnaires (one draft, promotes in place, three-layer immutability, snapshot `formatVersion`), questions (append-only, no bank draft state, items pin the version at add time), and what a response stores ([[2-design-doc#6. Versioning & Immutability]])
- [ ] **Database schema** — entities, relationships, constraints, indexes, response partitioning, audit approach. **Unblocked as of the versioning decision; this is the next thing.** ([[2-design-doc#12. Database]])
- [ ] API boundary: endpoint groups for definition vs. execution, error format and status conventions, access model and data barriers ([[2-design-doc#9. API / Service Boundary]])
- [ ] **Sessions & responses** — *retirement decided* (`closes_at`, hard cutoff). **Still open:** checkpoint endpoint, submit validation rules and idempotency key ([[2-design-doc#8. Sessions & Responses]], [[3-scaling#8. Open questions]])
- [ ] The v2 demo change for the seeded questionnaire ([[2-design-doc#18. Open Questions]] §1)
- [ ] Observability details: log fields/levels, standard span attributes, collector setup local vs. hosted, first metrics/alerts/SLOs ([[2-design-doc#14. Observability]])
- [ ] Testing approach: layers, tooling, one-command run against compose Postgres ([[2-design-doc#15. Testing]])
- [ ] Overview, goals, constraints sections ([[2-design-doc#1. Overview]] §1–3)
- [ ] Kubernetes subsection ([[2-design-doc#13.2 Long-term (Kubernetes) — *to be filled in*]]) and [[2-design-doc#16. Scale & Growth]] scale table summarised from [[3-scaling]]

## Phase 1 — Plan the build

- [ ] Flesh out implementation order and details below once Phase 0 decisions land (repo layout, package boundaries, seed data, demo script, README outline)

## Phase 2 — Build

*(to be filled in from Phase 1)*
