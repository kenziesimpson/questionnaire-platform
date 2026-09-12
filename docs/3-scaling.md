# Scaling Design

> Companion to [[2-design-doc]]. Covers how the system stays fast and reliable as questionnaires, versions, concurrent respondents, and stored responses grow. Written as levers to pull in order, each triggered by a measurement, not built up front. See also [[2-design-doc#16. Scale & Growth]] for the brief's five scale areas.

## 1. Constraints

1. **Response ingest must never block response reads.** A high volume of submissions must be absorbable without degrading respondent-facing reads (session resume, next-question) or admin/analytics reads.
2. **Questionnaire definition reads may be very hot.** Delivery of a published questionnaire and evaluation of its rules must stay fast under high concurrency, and the cost of each read should be minimised.
3. Published versions are immutable; historical responses keep their version. Every scaling lever must preserve this.
4. Prototype scope: a smaller, complete implementation is preferred. Levers below are documented with their trigger; only the day-one items are built.

## 2. Load model (what actually hits the backend)

Decisions from the design discussion that shape the numbers:

- **Whole definition sent once per session.** The client receives the full published version at session start and computes branching locally using the shared rule engine. No per-answer definition reads.
- **Partial answers live in the browser.** Answers-in-progress are kept client-side (IndexedDB/localStorage) keyed by session id. The server sees one submission per completed session.
- **Server-side session record.** A small session row (id, questionnaire, pinned version, started_at, status) is created at session start. It pins the version, makes submit idempotent, supports the republish/retire policy, and gives visibility into where respondents abandon.
- **Optional checkpoint.** `PUT /sessions/:id/progress` upserts a JSON blob of answers-so-far on a debounce. One upsert per session, not per answer. Enables cross-device resume and abandonment analysis; scope call whether it ships in the prototype.
- **Server is the authority.** On submit the server recomputes the reachable path from stored answers and the pinned version, rejects answers to unreachable questions and missing required ones. Client-side branching is a convenience, not trust.

Resulting per-session traffic: 1 session create, 1 definition fetch (cacheable, immutable), 0–N checkpoints (debounced), 1 submit.

## 3. Problem: response ingest vs. reads

### Reality check
Postgres MVCC means writes do not take locks that block readers; the real risk is resource contention (I/O, WAL, vacuum, connection pool). The constraint is therefore solved by **isolation of paths**, not by avoiding locks. With one submit per session, sustained write volume is well within what a single Postgres primary handles synchronously.

### Two kinds of readers
| Reader | Needs | Path |
| --- | --- | --- |
| Respondent (resume, next question) | Read-your-writes, low latency | Session record on primary; answers from browser storage (or checkpoint blob) |
| Admin / analytics | Cross-session queries, tolerates lag | Read replica |

### Levers, in order
1. **Day one.** Synchronous inserts behind a `ResponseSink` interface. Idempotency key on submit (session id + client-generated submission id) so retries and duplicates collapse. Responses table partitioned by time (`created_at`), indexed by session and questionnaire version. Structured logging on the submit path.
2. **Connection pooling.** PgBouncer (or managed pooler) in front of the primary once backend replicas multiply.
3. **Read replica** for admin/analytics/export queries. Replication lag is acceptable for these (per ideation).
4. **Ingest queue.** Trigger: submit p99 latency or primary write saturation. `ResponseSink` swaps to enqueue; a worker drains to Postgres in batches. Queue must be durable — Redis Streams with AOF fsync and ack-after-commit at minimum; SQS / NATS JetStream / Kafka if loss of acknowledged submissions is unacceptable at that scale. A lost acknowledged submission is the worst failure mode this system has.
5. **Ingest as its own service.** The queue consumer is already a separate worker; the API side of ingest becomes its own deployable once the respondent frontend is split (see [[#6. Future improvement: split the frontends]]). Deploy change, not a rewrite, provided the module boundary is kept from day one.
6. **Archival.** Older partitions detached and moved to cold storage / columnar store for analytics; retention policy per questionnaire.

## 4. Problem: hot definition reads

### Property that makes this cheap
Published versions are immutable, so a cache entry keyed by `(questionnaire_id, version)` never needs invalidation. The only mutable value is the pointer *questionnaire → current published version*.

### Levers, in order
1. **Day one.** Client fetches the definition once per session. Definition endpoint for a specific version returns `Cache-Control: public, max-age=<long>, immutable` + ETag. In-process cache in each backend replica for compiled definitions (rules pre-compiled into an evaluable structure once per version). Current-version pointer cached with a short TTL.
2. **CDN** in front of the respondent app absorbs repeat definition fetches entirely (works because of the immutable headers).
3. **Shared L2 cache (Redis)** for definitions when replica count makes in-process cold-starts noticeable. Pub/sub invalidation of the current-version pointer on publish.
4. **Degradation.** If Redis is unavailable, in-process cache and HTTP caching still serve; the system degrades to slightly more DB reads, not to failure.

## 5. Redis: role and boundaries
Not in the prototype. Appears as two distinct later levers — a **cache** ([[#4. Problem: hot definition reads]] §4.3, volatile, eviction OK) and a **durable queue** ([[#3. Problem: response ingest vs. reads]] §3.4, persistence required, no eviction). These have opposite configuration and would be separate instances (or the queue moves off Redis entirely). The compose/k8s layout should not bake in one shared instance.

## 6. Future improvement: split the frontends
The respondent questionnaire app and the admin portal will see very different traffic profiles; the questionnaire app is potentially hit far harder. Splitting them into separate deployables lets the respondent app sit behind a CDN with aggressive caching and edge rate limiting, while the admin app stays behind auth and never handles public traffic. It also enables ingest to become its own service ([[#3. Problem: response ingest vs. reads]] §3.5). Keep them as separate entry points / packages in the monorepo from the start so this is a deploy change later.

## 7. Known tradeoffs of browser-held partial answers
- No cross-device or cross-browser resume without the checkpoint endpoint.
- Incognito / cleared profile loses progress.
- Safari evicts IndexedDB/localStorage for sites not visited in ~7 days.
- Mitigation: checkpoint endpoint ([[#2. Load model (what actually hits the backend)]]), documented as the path to full resume.

## 8. Open questions
- Ship the checkpoint endpoint in the prototype or defer?
- Retirement policy for in-flight sessions: allow completion vs. block on submit.
- Whether unreachable (branch-only) questions should be withheld from the payload in sensitive deployments (ties to HIPAA future work).
