import { RESPONSES_PAGE_SIZE, type SessionSort, type SortOrder } from "@qp/shared";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { CursorDirection, SessionCursor, SessionOrdering } from "../../../src/db/reporting/cursor.js";
import { pageQueries } from "../../../src/db/reporting/sessions.js";
import { session } from "../../../src/db/schema.js";
import { aPublishedQuestionnaire, useTestDatabase, type PublishedFixture } from "../fixtures.js";

const testDatabase = useTestDatabase();

const SESSIONS_PER_QUESTIONNAIRE = 6000;
const OTHER_QUESTIONNAIRES = 2;
const MIDDLE_ID = "7f000000-0000-4000-8000-000000000000";

interface PlanNode {
  readonly "Node Type": string;
  readonly "Index Name"?: string;
  readonly "Index Cond"?: string;
  readonly "Scan Direction"?: string;
  readonly Filter?: string;
  readonly Plans?: PlanNode[];
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

async function fillWithSessions(execution: pg.Client, published: PublishedFixture): Promise<void> {
  await execution.query(
    `INSERT INTO execution.session
       (id, questionnaire_id, questionnaire_version_id, version, status, started_at, last_activity_at, submitted_at, response_digest)
     SELECT gen_random_uuid(), $1, $2, $3,
            CASE WHEN n % 5 = 0 THEN 'in_progress' ELSE 'submitted' END,
            timestamptz '2026-01-01' + n * interval '1 minute',
            timestamptz '2026-01-01' + n * interval '1 minute',
            CASE WHEN n % 5 = 0 THEN NULL ELSE timestamptz '2026-03-01' + ((n * 7919) % $4) * interval '1 second' END,
            CASE WHEN n % 5 = 0 THEN NULL ELSE '\\x01'::bytea END
       FROM generate_series(1, $4::int) AS n`,
    [published.questionnaireId, published.draftVersionId, published.version, SESSIONS_PER_QUESTIONNAIRE],
  );
}

async function aLargeTable(): Promise<PublishedFixture> {
  const definition = testDatabase.database("definition");
  const execution = await testDatabase.connect("execution");
  const target = await aPublishedQuestionnaire(definition);
  await fillWithSessions(execution, target);
  for (let i = 0; i < OTHER_QUESTIONNAIRES; i += 1) {
    await fillWithSessions(execution, await aPublishedQuestionnaire(definition));
  }
  const owner = await testDatabase.connect("owner");
  await owner.query("ANALYZE execution.session");
  return target;
}

type Segment = readonly RegExp[];

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
const FIRST_PAGE_CONDITION: Segment = [/^\(questionnaire_id = '[^']+'::uuid\)$/];
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
  const rowCondition: Segment = [new RegExp(`ROW\\(${column}, id\\) [<>] ROW\\(`)];
  const nullsAfterId: Segment = [AFTER_IN_PAGE_ORDER];
  const nullsOnly: Segment = [/\(submitted_at IS NULL\)\)$/];
  const valuesOnly: Segment = [/\(submitted_at IS NOT NULL\)\)$/];
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

async function problemsWith(client: pg.Client, planCase: PlanCase, target: PublishedFixture): Promise<string[]> {
  const reporting = testDatabase.database("reporting");
  const queries = pageQueries(reporting, [eq(session.questionnaireId, target.questionnaireId)], planCase.ordering, planCase.cursor);
  const problems: string[] = [];
  if (queries.length !== planCase.segments.length) {
    problems.push(`${planCase.ordering.sort} ${planCase.ordering.order}, ${planCase.name}: ${queries.length} statements, expected ${planCase.segments.length}`);
  }
  for (const [position, query] of queries.entries()) {
    const label = `${planCase.ordering.sort} ${planCase.ordering.order}, ${planCase.name}, statement ${position + 1}`;
    const { sql, params } = query(RESPONSES_PAGE_SIZE + 1).toSQL();
    const result = await client.query<{ "QUERY PLAN": [{ Plan: PlanNode }] }>(`EXPLAIN (FORMAT JSON) ${sql}`, params);
    const nodes = flatten(result.rows[0]?.["QUERY PLAN"][0]?.Plan as PlanNode);
    const scans = nodes.filter((node) => node["Node Type"] === "Index Scan");
    const [scan] = scans;
    const sorts = nodes.map((node) => node["Node Type"]).filter((type) => /Sort/.test(type));
    if (sorts.length > 0) problems.push(`${label}: plans ${sorts.join(", ")}`);
    if (scans.length !== 1 || scan?.["Index Name"] !== planCase.index) {
      problems.push(`${label}: scans ${scans.map((node) => node["Index Name"]).join(", ")}, expected ${planCase.index}`);
    }
    if (scan?.["Scan Direction"] !== planCase.scan) problems.push(`${label}: scans ${scan?.["Scan Direction"]}, expected ${planCase.scan}`);
    if (scan?.Filter !== undefined) problems.push(`${label}: filters ${scan.Filter}`);
    for (const expected of planCase.segments[position] ?? []) {
      if (!expected.test(scan?.["Index Cond"] ?? "")) problems.push(`${label}: Index Cond ${scan?.["Index Cond"]} does not match ${expected}`);
    }
  }
  return problems;
}

describe("the session list's queries, planned against 18,000 sessions of three questionnaires", () => {
  it("scan the expected index in the expected direction with the keyset in the Index Cond and no sort, for every sort, order and direction", async () => {
    const target = await aLargeTable();
    const client = await testDatabase.connect("reporting");
    const problems: string[] = [];
    for (const planCase of CASES) {
      problems.push(...(await problemsWith(client, planCase, target)));
    }

    expect(CASES).toHaveLength(16);
    expect(problems).toEqual([]);
  });
});
