# Implementation Plan

> Checkbox list. Design thinking happens in [[2-design-doc]] / [[3-scaling]]; this file tracks what's decided and what's built. Keep in dependency order.

## Phase 0 — Think through (decisions still open)

- [ ] Questionnaire format: question types, per-type validation/limits, structure & ordering, required-ness, serialization format with an example ([[2-design-doc#5. Questionnaire Format]])
- [ ] Versioning model: unit of versioning, what publish locks, draft → new version flow, where immutability is enforced, how the "change one question without changing meaning" demo works ([[2-design-doc#6. Versioning & Immutability]])
- [ ] Branching rules: condition model and operators, next-question evaluation, publish-time validation for cycles / unreachable questions / deadlock ([[2-design-doc#7. Branching Rules]])
- [ ] Database schema: entities, relationships, constraints, indexes, partitioning of responses, audit approach ([[2-design-doc#12. Database]])
- [ ] API boundary: endpoint groups for definition vs. execution, error format and status conventions, access model and data barriers ([[2-design-doc#9. API / Service Boundary]])
- [ ] Sessions & responses: retirement policy for in-flight sessions, whether the checkpoint endpoint ships, submit validation rules and idempotency key ([[2-design-doc#8. Sessions & Responses]], [[3-scaling#8. Open questions]])
- [ ] Observability details: log fields/levels, standard span attributes, collector setup local vs. hosted, first metrics/alerts/SLOs ([[2-design-doc#14. Observability]])
- [ ] Testing approach: layers, tooling, one-command run against compose Postgres ([[2-design-doc#15. Testing]])
- [ ] Overview, goals, constraints sections ([[2-design-doc#1. Overview]] §1–3)
- [ ] Kubernetes subsection ([[2-design-doc#13.2 Long-term (Kubernetes) — *to be filled in*]]) and [[2-design-doc#16. Scale & Growth]] scale table summarised from [[3-scaling]]

## Phase 1 — Plan the build

- [ ] Flesh out implementation order and details below once Phase 0 decisions land (repo layout, package boundaries, seed data, demo script, README outline)

## Phase 2 — Build

*(to be filled in from Phase 1)*
