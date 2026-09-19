import { RESPONSES_PAGE_SIZE, type SessionSort, type SessionStatus, type SortOrder } from "@qp/shared";
import { eq, type SQL } from "drizzle-orm";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { CursorDirection, SessionCursor, SessionOrdering } from "../../../src/db/reporting/cursor.js";
import { keysetSegments } from "../../../src/db/reporting/keyset.js";
import { pageQueries } from "../../../src/db/reporting/sessions.js";
import { session } from "../../../src/db/schema.js";
import { aPublishedQuestionnaire, publishNextVersion, useTestDatabase, type PublishedFixture } from "../fixtures.js";

const testDatabase = useTestDatabase();

const TARGET_SESSIONS = 30000;
const IN_PROGRESS_EVERY = 3000;
const RARE_VERSION_EVERY = 6000;
const OTHER_SESSIONS = 3000;
const OTHER_QUESTIONNAIRES = 2;
const MIDDLE_ID = "7f000000-0000-4000-8000-000000000000";
const RARE_VERSION = 2;
const ROWS_A_GOOD_PLAN_MAY_EXAMINE = 4 * (RESPONSES_PAGE_SIZE + 1);

interface PlanNode {
  readonly "Node Type": string;
  readonly "Index Name"?: string;
  readonly "Index Cond"?: string;
  readonly "Scan Direction"?: string;
  readonly Filter?: string;
  readonly "Actual Rows"?: number;
  readonly "Actual Loops"?: number;
  readonly "Rows Removed by Filter"?: number;
  readonly Plans?: PlanNode[];
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

function rowsExamined(node: PlanNode): number {
  return ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) * (node["Actual Loops"] ?? 1);
}

interface Population {
  readonly questionnaireId: string;
  readonly versionId: string;
  readonly version: number;
  readonly rareVersionId: string;
  readonly rareVersion: number;
  readonly count: number;
}

async function fillWithSessions(execution: pg.Client, population: Population): Promise<void> {
  await execution.query(
    `INSERT INTO execution.session
       (id, questionnaire_id, questionnaire_version_id, version, status, started_at, last_activity_at, submitted_at, response_digest)
     SELECT gen_random_uuid(), $1,
            CASE WHEN n % $7::int = 1 THEN $5::uuid ELSE $2::uuid END,
            CASE WHEN n % $7::int = 1 THEN $6::int ELSE $3::int END,
            CASE WHEN n % $8::int = 0 THEN 'in_progress' ELSE 'submitted' END,
            timestamptz '2026-01-01' + n * interval '1 minute',
            timestamptz '2026-01-01' + n * interval '1 minute',
            CASE WHEN n % $8::int = 0 THEN NULL ELSE timestamptz '2026-03-01' + ((n * 7919) % $4::int) * interval '1 second' END,
            CASE WHEN n % $8::int = 0 THEN NULL ELSE '\\x01'::bytea END
       FROM generate_series(1, $4::int) AS n`,
    [
      population.questionnaireId,
      population.versionId,
      population.version,
      population.count,
      population.rareVersionId,
      population.rareVersion,
      RARE_VERSION_EVERY,
      IN_PROGRESS_EVERY,
    ],
  );
}

function onlyItsOwnVersion(published: PublishedFixture): Population {
  return {
    questionnaireId: published.questionnaireId,
    versionId: published.draftVersionId,
    version: published.version,
    rareVersionId: published.draftVersionId,
    rareVersion: published.version,
    count: OTHER_SESSIONS,
  };
}

async function aLargeTable(): Promise<PublishedFixture> {
  const definition = testDatabase.database("definition");
  const execution = await testDatabase.connect("execution");
  const owner = await testDatabase.connect("owner");
  const target = await aPublishedQuestionnaire(definition);
  const items = [{ itemId: "itm_01", required: true, visibleWhen: null, questionId: target.questionId, questionVersion: 1 }];
  await publishNextVersion(definition, target.questionnaireId, items);
  const rare = await owner.query<{ id: string }>(
    "SELECT id FROM definition.questionnaire_version WHERE questionnaire_id = $1 AND version = $2",
    [target.questionnaireId, RARE_VERSION],
  );
  await fillWithSessions(execution, {
    questionnaireId: target.questionnaireId,
    versionId: target.draftVersionId,
    version: target.version,
    rareVersionId: rare.rows[0]?.id ?? "",
    rareVersion: RARE_VERSION,
    count: TARGET_SESSIONS,
  });
  for (let i = 0; i < OTHER_QUESTIONNAIRES; i += 1) {
    await fillWithSessions(execution, onlyItsOwnVersion(await aPublishedQuestionnaire(definition)));
  }
  await owner.query("ANALYZE execution.session");
  return target;
}

type RowClass = "any" | "valued" | "null";

interface Segment {
  readonly returns: RowClass;
  readonly conditions: readonly RegExp[];
}

interface PlanCase {
  readonly name: string;
  readonly ordering: SessionOrdering;
  readonly cursor: SessionCursor | undefined;
  readonly index: string;
  readonly scan: "Forward" | "Backward";
  readonly segments: readonly Segment[];
}

const SUBMITTED_MIDDLE = new Date("2026-03-01T01:00:00.000Z");
const STARTED_MIDDLE = new Date("2026-01-03T00:00:00.000Z");
const FIRST_PAGE_CONDITION: Segment = { returns: "any", conditions: [/^\(questionnaire_id = '[^']+'::uuid\)$/] };
const AFTER_IN_PAGE_ORDER = /submitted_at IS NULL\) AND \(id [<>] '/;

function cursorFor(ordering: SessionOrdering, direction: CursorDirection, sortValue: Date | null): SessionCursor {
  return { ...ordering, direction, sortValue, id: MIDDLE_ID };
}

function indexFor({ sort, order }: SessionOrdering): string {
  if (sort === "started") return "session_by_questionnaire";
  return order === "asc" ? "session_by_questionnaire_submitted_asc" : "session_by_questionnaire_submitted_desc";
}

function scanFor({ sort, order }: SessionOrdering, direction: CursorDirection): "Forward" | "Backward" {
  if (sort === "submitted") return direction === "forward" ? "Forward" : "Backward";
  return (order === "asc") === (direction === "forward") ? "Forward" : "Backward";
}

function casesFor(sort: SessionSort, order: SortOrder): PlanCase[] {
  const ordering = { sort, order } as const;
  const column = sort === "started" ? "started_at" : "submitted_at";
  const value = sort === "started" ? STARTED_MIDDLE : SUBMITTED_MIDDLE;
  const rowCondition: Segment = { returns: "valued", conditions: [new RegExp(`ROW\\(${column}, id\\) [<>] ROW\\(`)] };
  const nullsAfterId: Segment = { returns: "null", conditions: [AFTER_IN_PAGE_ORDER] };
  const nullsOnly: Segment = { returns: "null", conditions: [/\(submitted_at IS NULL\)\)$/] };
  const valuesOnly: Segment = { returns: "valued", conditions: [/\(submitted_at IS NOT NULL\)\)$/] };
  const planCase = (name: string, direction: CursorDirection, sortValue: Date | null | "none", segments: Segment[]): PlanCase => ({
    name,
    ordering,
    cursor: sortValue === "none" ? undefined : cursorFor(ordering, direction, sortValue),
    index: indexFor(ordering),
    scan: scanFor(ordering, direction),
    segments,
  });
  const cases = [
    planCase("the first page", "forward", "none", [FIRST_PAGE_CONDITION]),
    planCase(`forward from a session with a ${column}`, "forward", value, sort === "submitted" ? [rowCondition, nullsOnly] : [rowCondition]),
    planCase(`backward from a session with a ${column}`, "backward", value, [rowCondition]),
  ];
  if (sort === "submitted") {
    cases.push(
      planCase("forward from an in-progress session", "forward", null, [nullsAfterId]),
      planCase("backward from an in-progress session", "backward", null, [nullsAfterId, valuesOnly]),
    );
  }
  return cases;
}

const CASES = (["started", "submitted"] as const).flatMap((sort) => (["asc", "desc"] as const).flatMap((order) => casesFor(sort, order)));

type Bound = "the sorted index" | "a handful of rows" | "the table";

interface FilterCase {
  readonly name: string;
  readonly conditions: readonly SQL[];
  readonly status: SessionStatus | undefined;
  readonly bound: Bound;
  readonly filter: RegExp | undefined;
}

const FILTERS: readonly FilterCase[] = [
  { name: "unfiltered", conditions: [], status: undefined, bound: "the sorted index", filter: undefined },
  {
    name: "status=submitted",
    conditions: [eq(session.status, "submitted")],
    status: "submitted",
    bound: "the sorted index",
    filter: /^\(status = 'submitted'::text\)$/,
  },
  {
    name: "status=in_progress",
    conditions: [eq(session.status, "in_progress")],
    status: "in_progress",
    bound: "a handful of rows",
    filter: undefined,
  },
  {
    name: "the common version",
    conditions: [eq(session.version, 1)],
    status: undefined,
    bound: "the sorted index",
    filter: /^\(version = 1\)$/,
  },
  { name: "a rare version", conditions: [eq(session.version, RARE_VERSION)], status: undefined, bound: "the table", filter: undefined },
];

function survivesStatus(planCase: PlanCase, status: SessionStatus | undefined, segment: Segment): boolean {
  if (status === undefined || segment.returns === "any" || planCase.ordering.sort === "started") return true;
  return (status === "submitted") === (segment.returns === "valued");
}

const READ_NODE = /Scan$/;
const SCANS_A_RARE_VERSION_MAY_USE = new Set(["Seq Scan", "Bitmap Heap Scan", "Bitmap Index Scan", "Index Scan", "Sort", "Limit"]);

function planProblems(label: string, nodes: readonly PlanNode[], planCase: PlanCase, filterCase: FilterCase, expected: Segment | undefined): string[] {
  const problems: string[] = [];
  const reads = nodes.filter((node) => READ_NODE.test(node["Node Type"]));
  const examined = Math.max(0, ...reads.map(rowsExamined));

  if (filterCase.bound === "the table") {
    const unexpected = nodes.map((node) => node["Node Type"]).filter((type) => !SCANS_A_RARE_VERSION_MAY_USE.has(type));
    if (unexpected.length > 0) problems.push(`${label}: plans ${unexpected.join(", ")}`);
    return problems;
  }

  if (examined > ROWS_A_GOOD_PLAN_MAY_EXAMINE) {
    problems.push(`${label}: reads ${examined} rows to return a page of at most ${RESPONSES_PAGE_SIZE + 1}`);
  }
  if (filterCase.bound === "a handful of rows") return problems;

  const scans = nodes.filter((node) => node["Node Type"] === "Index Scan");
  const [scan] = scans;
  const sorts = nodes.map((node) => node["Node Type"]).filter((type) => /Sort/.test(type));
  if (sorts.length > 0) problems.push(`${label}: plans ${sorts.join(", ")}`);
  if (scans.length !== 1 || scan?.["Index Name"] !== planCase.index) {
    problems.push(`${label}: scans ${scans.map((node) => node["Index Name"]).join(", ")}, expected ${planCase.index}`);
  }
  if (scan?.["Scan Direction"] !== planCase.scan) problems.push(`${label}: scans ${scan?.["Scan Direction"]}, expected ${planCase.scan}`);
  if (filterCase.filter === undefined && scan?.Filter !== undefined) problems.push(`${label}: filters ${scan.Filter}`);
  if (filterCase.filter !== undefined && !filterCase.filter.test(scan?.Filter ?? "")) {
    problems.push(`${label}: filters ${scan?.Filter}, expected ${filterCase.filter}`);
  }
  for (const condition of expected?.conditions ?? []) {
    if (!condition.test(scan?.["Index Cond"] ?? "")) problems.push(`${label}: Index Cond ${scan?.["Index Cond"]} does not match ${condition}`);
  }
  return problems;
}

async function problemsWith(client: pg.Client, planCase: PlanCase, filterCase: FilterCase, target: PublishedFixture): Promise<string[]> {
  const reporting = testDatabase.database("reporting");
  const direction = planCase.cursor?.direction ?? "forward";
  const segments = keysetSegments(planCase.ordering, planCase.cursor, filterCase.status);
  const queries = pageQueries(reporting, [eq(session.questionnaireId, target.questionnaireId), ...filterCase.conditions], planCase.ordering, direction, segments);
  const expected = planCase.segments.filter((segment) => survivesStatus(planCase, filterCase.status, segment));
  const problems: string[] = [];
  if (queries.length !== expected.length) {
    problems.push(`${filterCase.name}, ${planCase.ordering.sort} ${planCase.ordering.order}, ${planCase.name}: ${queries.length} statements, expected ${expected.length}`);
  }
  for (const [position, query] of queries.entries()) {
    const label = `${filterCase.name}, ${planCase.ordering.sort} ${planCase.ordering.order}, ${planCase.name}, statement ${position + 1}`;
    const { sql, params } = query(RESPONSES_PAGE_SIZE + 1).toSQL();
    const result = await client.query<{ "QUERY PLAN": [{ Plan: PlanNode }] }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
    const nodes = flatten(result.rows[0]?.["QUERY PLAN"][0]?.Plan as PlanNode);
    problems.push(...planProblems(label, nodes, planCase, filterCase, expected[position]));
  }
  return problems;
}

describe("the session list's queries, planned against 36,000 sessions of three questionnaires", () => {
  it("scan the expected index in the expected direction with the keyset in the Index Cond and no sort, for every sort, order and direction, and stay bounded under a status or common-version filter", async () => {
    const target = await aLargeTable();
    const client = await testDatabase.connect("reporting");
    const problems: string[] = [];
    for (const filterCase of FILTERS) {
      for (const planCase of CASES) {
        problems.push(...(await problemsWith(client, planCase, filterCase, target)));
      }
    }

    expect(CASES).toHaveLength(16);
    expect(problems).toEqual([]);
  });
});
