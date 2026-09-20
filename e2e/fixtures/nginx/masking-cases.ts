import { definitionApi, executionApi, reportingApi, routePath, telemetryApi } from "@qp/shared";

const SESSION_ID ="7f3c2a10-5b1e-4c7d-9a2e-0d6b8e4f1a35";
const QUESTIONNAIRE_ID = "0b9e4c21-3d5a-4f6b-8c7d-1e2f3a4b5c6d";
const CURSOR = "Zm9yd2FyZHwyMDI2LTA5LTE5fDdmM2MyYTEwLTViMWUtNGM3ZC05YTJlLTBkNmI4ZTRmMWEzNQ";
const QUERY_VALUE = "qp-nginx-anchor-query-value";

export const SECRETS: readonly string[] = [SESSION_ID, CURSOR, QUERY_VALUE];

const UNMATCHED =":unmatched";
const SESSION_SLOT = ":sessionId";

const LONG_SEGMENT = "a".repeat(6000);

export interface MaskingCase {
  readonly name: string;
  readonly target: string;
  readonly route: string;
  readonly headersRead: boolean;
}

function maskingCase(name: string, target: string, route: string, headersRead = true): MaskingCase {
  return { name, target, route, headersRead };
}

interface SharedRoute {
  readonly url: string;
}

const SHARED_ROUTES: readonly { readonly prefix: string; readonly routes: readonly SharedRoute[] }[] = [
  { prefix: definitionApi.DEFINITION_PREFIX, routes: definitionApi.definitionRoutes },
  { prefix: executionApi.EXECUTION_PREFIX, routes: executionApi.executionRoutes },
  { prefix: reportingApi.REPORTING_PREFIX, routes: reportingApi.reportingRoutes },
  { prefix: telemetryApi.TELEMETRY_PREFIX, routes: telemetryApi.telemetryRoutes },
];

export const SESSION_ROUTE_PATHS: readonly string[] = SHARED_ROUTES.flatMap(({ prefix, routes }) =>
  routes
    .filter((route) => route.url.includes(":sessionId"))
    .map((route) => routePath(`${prefix}${route.url}`, { id: QUESTIONNAIRE_ID, sessionId: SESSION_ID })),
);

const ADMIN_RESPONSES = `/admin/questionnaires/${QUESTIONNAIRE_ID}/responses`;
const REPORTING_RESPONSES = `/api/reporting/questionnaires/${QUESTIONNAIRE_ID}/responses`;
const RUN_SESSIONS = "/api/run/sessions";

const CURSOR_QUERY = `cursor=${CURSOR}&note=${QUERY_VALUE}`;

function familyCases(label: string, path: string, route: string): MaskingCase[] {
  return [
    maskingCase(label, path, route),
    maskingCase(`${label} with a trailing slash`, `${path}/`, route),
    maskingCase(`${label} with a cursor query`, `${path}?${CURSOR_QUERY}`, route),
  ];
}

const sharedRouteCases = SESSION_ROUTE_PATHS.flatMap((path) => {
  const route = path.replace(SESSION_ID, SESSION_SLOT);
  return familyCases(`the shared route ${route}`, path, route);
});

const adminDetailCases = familyCases(
  "the admin's response detail path",
  `${ADMIN_RESPONSES}/${SESSION_ID}`,
  `${ADMIN_RESPONSES}/${SESSION_SLOT}`,
);

const slotCases: MaskingCase[] = [
  maskingCase("an upper-case session id in the slot", `${RUN_SESSIONS}/${SESSION_ID.toUpperCase()}`, `${RUN_SESSIONS}/${SESSION_SLOT}`),
  maskingCase("a percent-encoded hyphen in the slot", `${RUN_SESSIONS}/${SESSION_ID.replace("-", "%2D")}`, `${RUN_SESSIONS}/${SESSION_SLOT}`),
  maskingCase("a percent-encoded slash after the id", `${RUN_SESSIONS}/${SESSION_ID}%2Fsubmit`, `${RUN_SESSIONS}/${SESSION_SLOT}`),
  maskingCase("a slot that is not a UUID", `${RUN_SESSIONS}/not-a-uuid`, `${RUN_SESSIONS}/${SESSION_SLOT}`),
  maskingCase("a very long slot", `${RUN_SESSIONS}/${LONG_SEGMENT}`, `${RUN_SESSIONS}/${SESSION_SLOT}`),
];

const queryCases: MaskingCase[] = [
  maskingCase("a reporting list with a cursor and an order", `${REPORTING_RESPONSES}?cursor=${CURSOR}&order=asc`, REPORTING_RESPONSES),
  maskingCase("an admin list with a cursor", `${ADMIN_RESPONSES}?cursor=${CURSOR}`, ADMIN_RESPONSES),
  maskingCase(
    "a percent-encoded cursor name beside a plain one",
    `${ADMIN_RESPONSES}?%63ursor=${CURSOR}&cursor=${CURSOR}&note=${QUERY_VALUE}`,
    ADMIN_RESPONSES,
  ),
  maskingCase("a session id and a value in a query", `${RUN_SESSIONS}?session=${SESSION_ID}&note=${QUERY_VALUE}`, RUN_SESSIONS),
];

const bypassCases: MaskingCase[] = [
  maskingCase("a percent-encoded prefix", `/api/%72un/sessions/${SESSION_ID}`, UNMATCHED),
  maskingCase("a doubled leading slash", `//api/run/sessions/${SESSION_ID}`, UNMATCHED),
  maskingCase("a doubled slash inside", `/api/run//sessions/${SESSION_ID}`, UNMATCHED),
  maskingCase("a dot segment", `/api/./run/sessions/${SESSION_ID}`, UNMATCHED),
  maskingCase("a dot-dot segment", `/api/x/../run/sessions/${SESSION_ID}`, UNMATCHED),
  maskingCase("a dot segment in the session slot", `${RUN_SESSIONS}/./${SESSION_ID}`, UNMATCHED),
  maskingCase("a doubled slash in the admin path", `/admin//questionnaires/${QUESTIONNAIRE_ID}/responses/${SESSION_ID}`, UNMATCHED),
  maskingCase("a longer path under a session", `${RUN_SESSIONS}/${SESSION_ID}/anything/else`, UNMATCHED),
  maskingCase("a longer path under a reporting response", `${REPORTING_RESPONSES}/${SESSION_ID}/extra`, UNMATCHED),
  maskingCase("a longer path under an admin response", `${ADMIN_RESPONSES}/${SESSION_ID}/extra`, UNMATCHED),
  maskingCase("a non-ASCII byte", `${RUN_SESSIONS}/${SESSION_ID}/é`, UNMATCHED),
  maskingCase("a very long path", `${RUN_SESSIONS}/${SESSION_ID}/${LONG_SEGMENT}`, UNMATCHED),
  maskingCase("an empty target", "", UNMATCHED, false),
];

const absoluteFormCases: MaskingCase[] = [
  maskingCase("an absolute-form target", `http://example.test${RUN_SESSIONS}/${SESSION_ID}`, `${RUN_SESSIONS}/${SESSION_SLOT}`),
  maskingCase(
    "an absolute-form target with a port and a reporting path",
    `http://example.test:8080${REPORTING_RESPONSES}/${SESSION_ID}?${CURSOR_QUERY}`,
    `${REPORTING_RESPONSES}/${SESSION_SLOT}`,
  ),
  maskingCase("an absolute-form target with a doubled slash", `http://example.test//api/run/sessions/${SESSION_ID}`, UNMATCHED),
];

const safeCases: MaskingCase[] = [
  "/",
  "/admin/",
  "/admin/questionnaires",
  RUN_SESSIONS,
  "/assets/index-abc123.js",
  "/assets/chunk.min.js",
  `/q/${QUESTIONNAIRE_ID}`,
  ADMIN_RESPONSES,
  `/api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft`,
  `/api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft/`,
].map((path) => maskingCase(`the safe path ${path}`, path, path));

export const MASKING_CASES: readonly MaskingCase[] = [
  ...sharedRouteCases,
  ...adminDetailCases,
  ...slotCases,
  ...queryCases,
  ...bypassCases,
  ...absoluteFormCases,
  ...safeCases,
];
