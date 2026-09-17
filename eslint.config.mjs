// Why these boundaries exist: [[11-structural-refactor]] §4, [[7-application-boundary]] §3.1, [[6-observability]] §3.1.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const everyFile = ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];

const reactWorkspaces = ["apps/respondent/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"];

const telemetryOnly = {
  group: ["pino", "pino/*", "pino-*", "@opentelemetry/*"],
  message:
    "Only packages/telemetry may import pino or OpenTelemetry. Log, trace and count through @qp/telemetry so answer values cannot reach an exporter.",
};

const pathGap = "/+(\\./+)*";

function otherModule(name) {
  return {
    regex: `(^|/)modules${pathGap}${name}(/|$)|^(\\.{1,2}/+)*\\.\\./+(\\.{1,2}/+)*${name}(/|$)`,
    message: `The definition and execution modules share nothing but @qp/shared. Importing modules/${name} crosses the boundary.`,
  };
}

const definitionDbLayer = {
  regex: `(^|/)db${pathGap}(definition|seed)(/|$)|(^|/)db${pathGap}audit(\\.[cm]?[jt]s)?$`,
  message:
    "db/definition, db/seed and db/audit belong to the definition side. Execution may use db/client, db/schema and the rest of the db layer, but not those.",
};

const anyModule = {
  regex: "(^|/)modules(/|$)",
  message: "db/definition sits below the backend modules and imports none of them.",
};

const doubleAssertionThrough = (keyword, spelling) =>
  ["TSAsExpression", "TSTypeAssertion"].map((inner) => ({
    selector: `TSAsExpression > ${inner}.expression[typeAnnotation.type="${keyword}"]`,
    message: `Casting through \`${spelling}\` compiles for any two types and switches type checking off. Fix the types; if the cast is genuinely unavoidable, disable this line with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>`,
  }));

const doubleAssertions = [...doubleAssertionThrough("TSUnknownKeyword", "unknown"), ...doubleAssertionThrough("TSAnyKeyword", "any")];

const routePathLiteral = {
  selector: "Literal[regex.pattern=/^:\\(/]",
  message:
    "Route paths are filled in by routePath in packages/shared/src/api/request.ts, which is the one place that knows the `:param` syntax. Import it instead of matching `:param` with a regex.",
};

const restrict = (...patterns) => ["error", { patterns: [telemetryOnly, ...patterns] }];

const confine = (...globals) => ["error", ...globals];

const syntax = (...selectors) => ["warn", ...doubleAssertions, routePathLiteral, ...selectors];

const appSources = ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"];

const problemParsingMessage =
  "Problem bodies are read off the wire by problemFromWire in packages/shared/src/problems.ts, which owns the code guards and the unknown-code policy. Parse through it and keep only this consumer's policy here.";

const problemParsing = [
  {
    selector: 'CallExpression[callee.object.name="Value"][callee.property.name="Check"][arguments.0.name="ProblemDetails"]',
    message: problemParsingMessage,
  },
  {
    selector: "TSTypePredicate[typeAnnotation.typeAnnotation.typeName.name=/^(PointerError|RequestErrorCode|DraftItemCode|SubmissionItemCode|ItemError)$/]",
    message: problemParsingMessage,
  },
];

const notFoundProblem = {
  selector: 'CallExpression[callee.name="problem"][arguments.0.value="resource/not-found"]',
  message:
    "The `resource/not-found` body is built in one place, notFoundProblem in apps/backend/src/http/problems.ts. Call that instead, and read one off the wire with problemFromWire.",
};

const syntaxInsideTheRoutePathHelper = ["warn", ...doubleAssertions, ...problemParsing, notFoundProblem];

const fetchOwners = ["apps/*/src/api/**", "e2e/fixtures/**", "e2e/stack/**"];

const fetchOutsideApiClients = {
  name: "fetch",
  message:
    "fetch belongs to an app's API client (apps/*/src/api/**) or to the e2e fixtures and stack, so one module per app owns the transport that trace headers and client spans will attach to.",
};

const rawSqlMessage =
  "Raw SQL through drizzle's `sql` bypasses the query builder's types. Use the builder (eq, and, exists, notExists, max, inArray, …); if Postgres needs something the builder cannot express, such as calling a database function or DDL, disable it with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>";

const rawSql = [
  { selector: 'TaggedTemplateExpression[tag.type="Identifier"][tag.name="sql"]', message: rawSqlMessage },
  { selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="sql"]', message: rawSqlMessage },
];

const connectionConstructionMessage =
  "Connections come from one constructor: `openDatabase` in apps/backend/src/db/client.ts, which is where pool sizing lands ([[2-design-doc#17. Decisions Log]] #77). Constructing a pg client or pool directly bypasses it. Where a raw connection is genuinely needed — connecting to another database in order to create one — disable it with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>";

const connectionConstruction = [
  {
    selector: 'NewExpression[callee.object.name="pg"][callee.property.name=/^(Client|Pool)$/]',
    message: connectionConstructionMessage,
  },
  { selector: 'NewExpression[callee.name=/^(Client|Pool)$/]', message: connectionConstructionMessage },
];

const openDatabaseOutsideTheHarness = {
  regex: "(^|/)db/client(\\.[cm]?[jt]s)?$",
  importNames: ["openDatabase"],
  allowTypeImports: true,
  message:
    "Backend tests take databases from useTestDatabase() in _tests/db/harness.ts, so the harness owns every connection's lifetime and budget (Decisions Log #77). Type imports from db/client are fine. If a test genuinely needs its own handle, disable it with a reason: // eslint-disable-next-line no-restricted-imports -- <reason>",
};

const filesThatMayConstructConnections = [
  "apps/backend/src/db/client.ts",
  "apps/backend/_tests/db/harness.ts",
  "apps/backend/_tests/db/global-setup.ts",
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/playwright-report/**", "**/test-results/**", "**/.stacks/**"],
  },
  {
    name: "parser and disable directives",
    files: everyFile,
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    name: "telemetry imports",
    files: everyFile,
    rules: { "no-restricted-imports": restrict() },
  },
  {
    name: "telemetry imports inside packages/telemetry",
    files: ["packages/telemetry/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    name: "double type assertions",
    files: everyFile,
    rules: { "no-restricted-syntax": syntax() },
  },
  {
    name: "raw SQL and connection construction in the backend",
    files: ["apps/backend/**/*.ts"],
    ignores: ["apps/backend/src/db/schema.ts"],
    rules: { "no-restricted-syntax": syntax(...rawSql, ...connectionConstruction) },
  },
  {
    name: "connection construction inside the connection constructors",
    files: filesThatMayConstructConnections,
    rules: { "no-restricted-syntax": syntax(...rawSql) },
  },
  {
    name: "openDatabase imports in backend tests",
    files: ["apps/backend/_tests/**/*.ts"],
    ignores: ["apps/backend/_tests/db/harness.ts"],
    rules: { "no-restricted-imports": restrict(openDatabaseOutsideTheHarness) },
  },
  {
    name: "module boundary: definition",
    files: ["apps/backend/src/modules/definition/**"],
    rules: { "no-restricted-imports": restrict(otherModule("execution")) },
  },
  {
    name: "module boundary: execution",
    files: ["apps/backend/src/modules/execution/**"],
    rules: { "no-restricted-imports": restrict(otherModule("definition"), definitionDbLayer) },
  },
  {
    name: "module boundary: the definition side of the db layer",
    files: ["apps/backend/src/db/definition/**"],
    rules: { "no-restricted-imports": restrict(anyModule) },
  },
  {
    ...reactHooks.configs.flat.recommended,
    files: reactWorkspaces,
  },
  {
    name: "L10: problem bodies are parsed only by problemFromWire",
    files: appSources,
    ignores: ["apps/backend/src/**", "packages/shared/src/problems.ts"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem) },
  },
  {
    name: "L16: fetch only in API client modules",
    files: everyFile,
    ignores: fetchOwners,
    rules: { "no-restricted-globals": confine(fetchOutsideApiClients) },
  },
  {
    name: "L6: routePath owns the :param syntax",
    files: ["packages/shared/src/api/request.ts"],
    rules: { "no-restricted-syntax": syntaxInsideTheRoutePathHelper },
  },
);
