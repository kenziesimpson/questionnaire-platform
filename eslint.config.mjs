// Why these boundaries exist: [[11-structural-refactor]] §4, [[7-application-boundary]] §3.1, [[6-observability]] §3.1.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const everyFile = ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];

const everySourceFile = ["**/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];

const reactWorkspaces = ["apps/respondent/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"];

const telemetryOnly = {
  group: ["pino", "pino/*", "pino-*", "@opentelemetry/*"],
  message:
    "Only packages/telemetry may import pino or OpenTelemetry. Log, trace and count through @qp/telemetry so answer values cannot reach an exporter.",
};

const pathGap = "/+(\\./+)*";

const relativeSibling = (name) => `^(\\.{1,2}/+)*\\.\\./+(\\.{1,2}/+)*${name}`;

function otherModule(name) {
  return {
    regex: `(^|/)modules${pathGap}${name}(/|$)|${relativeSibling(name)}(/|$)`,
    message: `The definition and execution modules share nothing but @qp/shared. Importing modules/${name} crosses the boundary.`,
  };
}

const definitionSideOfTheDbLayer = `(^|/)db${pathGap}(definition|seed)(/|$)|(^|/)db${pathGap}audit(\\.[cm]?[jt]s)?$`;

const definitionDbLayerMessage =
  "db/definition, db/seed and db/audit belong to the definition side. Execution may use db/client, db/schema and the rest of the db layer, but not those.";

const definitionDbLayer = {
  regex: definitionSideOfTheDbLayer,
  message: definitionDbLayerMessage,
};

const definitionDbLayerFromItsSibling = {
  regex: `${definitionSideOfTheDbLayer}|${relativeSibling("(definition|seed)")}(/|$)|${relativeSibling("audit")}(\\.[cm]?[jt]s)?$`,
  message: definitionDbLayerMessage,
};

const executionSideOfTheDbLayer = `(^|/)db${pathGap}execution(/|$)`;

const executionDbLayerMessage =
  "db/execution belongs to the execution side. The definition half of the backend reaches no session or response persistence; it sees execution only through @qp/shared.";

const executionDbLayer = {
  regex: executionSideOfTheDbLayer,
  message: executionDbLayerMessage,
};

const executionDbLayerFromItsSibling = {
  regex: `${executionSideOfTheDbLayer}|${relativeSibling("execution")}(/|$)`,
  message: executionDbLayerMessage,
};

const anyModuleBelow = (side) => ({
  regex: "(^|/)modules(/|$)",
  message: `db/${side} sits below the backend modules and imports none of them.`,
});

const doubleAssertionThrough = (keyword, spelling) =>
  ["TSAsExpression", "TSTypeAssertion"].map((inner) => ({
    selector: `TSAsExpression > ${inner}.expression[typeAnnotation.type="${keyword}"]`,
    message: `Casting through \`${spelling}\` compiles for any two types and switches type checking off. Fix the types; if the cast is genuinely unavoidable, disable this line with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>`,
  }));

const doubleAssertions = [...doubleAssertionThrough("TSUnknownKeyword", "unknown"), ...doubleAssertionThrough("TSAnyKeyword", "any")];

const appLibraries = [
  {
    home: "apps/admin",
    group: ["@tanstack/react-query", "@tanstack/react-query/*"],
    message:
      "TanStack Query holds admin's cached server state ([[2-design-doc#17. Decisions Log]] #32). The respondent app makes three uncached calls through fetch and takes no query library.",
  },
  {
    home: "apps/admin",
    group: ["@tanstack/react-router", "@tanstack/react-router/*"],
    message:
      "TanStack Router routes apps/admin ([[2-design-doc#17. Decisions Log]] #32). The respondent app is one URL and routes nothing.",
  },
  {
    home: "apps/admin",
    group: ["@dnd-kit/*"],
    message:
      "dnd-kit reorders draft items and question options in apps/admin ([[2-design-doc#17. Decisions Log]] #32). Nothing else in the repository drags.",
  },
  {
    home: "apps/respondent",
    group: ["@tanstack/react-form", "@tanstack/react-form/*"],
    message:
      "TanStack Form carries the respondent's per-field validation and touched state ([[2-design-doc#17. Decisions Log]] #32). Admin's two hard forms are shaped at runtime and take no form library.",
  },
  {
    home: "packages/ui/src/primitives",
    group: ["radix-ui", "radix-ui/*"],
    message:
      "Radix is reached through the shared primitives in packages/ui/src/primitives ([[2-design-doc#17. Decisions Log]] #32). Apps import @qp/ui so both get one component set.",
  },
];

const librariesAwayFrom = (home) => appLibraries.filter((library) => library.home !== home).map(({ group, message }) => ({ group, message }));

const restrictOutside = (home, ...patterns) => ["error", { patterns: [telemetryOnly, ...librariesAwayFrom(home), ...patterns] }];

const restrict = (...patterns) => restrictOutside(undefined, ...patterns);

const noDefaultExport = {
  selector: "ExportDefaultDeclaration",
  message:
    "Exports are named, so an import reads the same everywhere. Tool config files and the vitest and Playwright globalSetup and globalTeardown entry points are the exception, because those tools load a default export.",
};

const routePathLiteral = {
  selector: "Literal[regex.pattern=/^:\\(/]",
  message:
    "Route paths are filled in by routePath in packages/shared/src/api/request.ts, which is the one place that knows the `:param` syntax. Import it instead of matching `:param` with a regex.",
};

const syntaxAllowingDefaultExport = (...selectors) => ["warn", ...doubleAssertions, routePathLiteral, ...selectors];

const syntax = (...selectors) => syntaxAllowingDefaultExport(noDefaultExport, ...selectors);

const syntaxInsideTheRoutePathHelper = (...selectors) => ["warn", ...doubleAssertions, noDefaultExport, ...selectors];

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
    "The `resource/not-found` body is built in one place. Call that builder instead, and read one off the wire with problemFromWire.",
};

const frontendAndSharedSources = ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"];

const theProblemParser = "packages/shared/src/problems.ts";

const theRoutePathHelper = "packages/shared/src/api/request.ts";

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

const confine = (...globals) => ["error", ...globals];

const apiClients = ["apps/*/src/api/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];

const fetchOwners = [...apiClients, "e2e/fixtures/**", "e2e/stack/**"];

const fetchAwayFromTheTransport = {
  name: "fetch",
  message:
    "fetch belongs to an app's API client (apps/*/src/api/**) or to the e2e fixtures and stack, so one module per app owns the transport that trace headers and client spans will attach to.",
};

const persistenceSeamMessage =
  "The respondent reads and writes partial answers through apps/respondent/src/storage, so the envelope format, the quota and failure handling, and later the telemetry around them live in one seam.";

const localStorageAwayFromTheSeam = { name: "localStorage", message: persistenceSeamMessage };

const localStorageThroughAnObject = ["window", "globalThis"].map((object) => ({
  object,
  property: "localStorage",
  message: persistenceSeamMessage,
}));

const terminalEntryPoints = [
  "apps/backend/src/db/migrate.ts",
  "apps/backend/src/db/seed/seed.ts",
  "e2e/stack/stack-cli.ts",
  "e2e/stack/global-setup.ts",
  "e2e/stack/global-teardown.ts",
];

const filesThatMustDefaultExport = [
  "**/*.config.{ts,tsx,mts,cts,js,mjs,cjs}",
  "apps/backend/_tests/db/global-setup.ts",
  "e2e/stack/global-setup.ts",
  "e2e/stack/global-teardown.ts",
];

const backendFilesThatMustDefaultExport = ["apps/backend/**/*.config.{ts,tsx,mts,cts,js,mjs,cjs}"];

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
    rules: { "no-restricted-imports": restrict(otherModule("execution"), executionDbLayer) },
  },
  {
    name: "module boundary: execution",
    files: ["apps/backend/src/modules/execution/**"],
    rules: { "no-restricted-imports": restrict(otherModule("definition"), definitionDbLayer) },
  },
  {
    name: "module boundary: the definition side of the db layer",
    files: ["apps/backend/src/db/definition/**"],
    rules: { "no-restricted-imports": restrict(anyModuleBelow("definition"), executionDbLayerFromItsSibling) },
  },
  {
    name: "module boundary: the execution side of the db layer",
    files: ["apps/backend/src/db/execution/**"],
    rules: { "no-restricted-imports": restrict(anyModuleBelow("execution"), definitionDbLayerFromItsSibling) },
  },
  {
    ...reactHooks.configs.flat.recommended,
    files: reactWorkspaces,
  },
  {
    name: "library split by app: admin",
    files: ["apps/admin/**"],
    rules: { "no-restricted-imports": restrictOutside("apps/admin") },
  },
  {
    name: "library split by app: respondent",
    files: ["apps/respondent/**"],
    rules: { "no-restricted-imports": restrictOutside("apps/respondent") },
  },
  {
    name: "library split by app: the shared primitives",
    files: ["packages/ui/src/primitives/**"],
    rules: { "no-restricted-imports": restrictOutside("packages/ui/src/primitives") },
  },
  {
    name: "L16: fetch outside the API clients, the e2e fixtures and the e2e stack",
    files: everyFile,
    ignores: fetchOwners,
    rules: { "no-restricted-globals": confine(fetchAwayFromTheTransport) },
  },
  {
    name: "L16 and L17: fetch and localStorage in the sources that own neither",
    files: everySourceFile,
    ignores: [...apiClients, "apps/respondent/src/storage/**"],
    rules: {
      "no-restricted-globals": confine(fetchAwayFromTheTransport, localStorageAwayFromTheSeam),
      "no-restricted-properties": ["error", ...localStorageThroughAnObject],
    },
  },
  {
    name: "L17: localStorage inside the API clients, which own the transport but not the persistence seam",
    files: apiClients,
    rules: {
      "no-restricted-globals": confine(localStorageAwayFromTheSeam),
      "no-restricted-properties": ["error", ...localStorageThroughAnObject],
    },
  },
  {
    name: "console outside the entry points that write to a terminal",
    files: [...everySourceFile, "e2e/**/*.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
  {
    name: "the entry points that write to a terminal",
    files: terminalEntryPoints,
    rules: { "no-console": "off" },
  },
  {
    name: "default exports in tool config files and framework entry points",
    files: filesThatMustDefaultExport,
    rules: { "no-restricted-syntax": syntaxAllowingDefaultExport() },
  },
  {
    name: "default exports in the backend's tool config files",
    files: backendFilesThatMustDefaultExport,
    rules: { "no-restricted-syntax": syntaxAllowingDefaultExport(...rawSql, ...connectionConstruction) },
  },
  {
    name: "default exports in the backend harness's globalSetup, which constructs connections",
    files: ["apps/backend/_tests/db/global-setup.ts"],
    rules: { "no-restricted-syntax": syntaxAllowingDefaultExport(...rawSql) },
  },
  {
    name: "L10: problem bodies in the frontends and the shared packages",
    files: frontendAndSharedSources,
    ignores: ["apps/backend/src/**", theProblemParser],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem) },
  },
  {
    name: "L10: problem bodies in the backend, alongside its raw SQL and connection restrictions",
    files: ["apps/backend/src/**/*.ts"],
    ignores: ["apps/backend/src/db/schema.ts", "apps/backend/src/db/client.ts"],
    rules: { "no-restricted-syntax": syntax(...rawSql, ...connectionConstruction, ...problemParsing) },
  },
  {
    name: "L10: problem bodies in the schema declaration, whose checks and defaults are SQL expressions",
    files: ["apps/backend/src/db/schema.ts"],
    rules: { "no-restricted-syntax": syntax(...problemParsing) },
  },
  {
    name: "L10: problem bodies in the connection constructor, which constructs connections",
    files: ["apps/backend/src/db/client.ts"],
    rules: { "no-restricted-syntax": syntax(...rawSql, ...problemParsing) },
  },
  {
    name: "L6: routePath owns the :param syntax",
    files: [theRoutePathHelper],
    rules: { "no-restricted-syntax": syntaxInsideTheRoutePathHelper(...problemParsing, notFoundProblem) },
  },
);
