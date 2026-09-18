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

const privateAdminScreens = ["draft-editor", "question-bank", "questionnaire-list", "version-preview"];

const relativeSiblingOrSelf = (name) => `^(\\.{1,2}/+)*${name}/`;

function screenIsPrivate(name) {
  return {
    regex: `(^|/)screens${pathGap}${name}/|${relativeSiblingOrSelf(name)}`,
    message: `screens/${name}'s own directory is private: only screens/${name}.tsx and screens/${name}'s own files import it ([[11-structural-refactor]] L3).`,
  };
}

const screenOwnPaths = (name) => [`apps/admin/src/screens/${name}.tsx`, `apps/admin/src/screens/${name}/**`];

const allPrivateScreenPaths = privateAdminScreens.flatMap(screenOwnPaths);

const screensAreDownstream = {
  regex: `(^|/)screens(/|$)`,
  message:
    "screens/ is imported by lib, components, api and features, never the reverse ([[11-structural-refactor]] L3).",
};

const mutationsSeamMessage =
  "useMutation is imported only in src/api/mutations, so a mutation, its cache invalidation and its optimistic-update logic live in one place ([[11-structural-refactor]] L4).";

const mutationsOutsideTheirHome = {
  group: ["@tanstack/react-query"],
  importNames: ["useMutation"],
  message: mutationsSeamMessage,
};

const dateFormattingMessage =
  "Dates are formatted only in this app's src/lib/dates.ts, so one locale policy governs every date shown ([[11-structural-refactor]] L21).";

const dateFormatting = [
  {
    selector: "MemberExpression[property.name=/^toLocale(Date|Time)?String$/]",
    message: dateFormattingMessage,
  },
  {
    selector: 'NewExpression[callee.type="MemberExpression"][callee.object.name="Intl"][callee.property.name="DateTimeFormat"]',
    message: dateFormattingMessage,
  },
];

const adminDatesHome = "apps/admin/src/lib/dates.ts";

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

const testSupportLibraries = [
  {
    home: "packages/ui/src/testing",
    group: ["axe-core", "axe-core/*", "vitest-axe", "vitest-axe/*"],
    message:
      "Accessibility checks run through axeViolations and componentAxeViolations in @qp/ui/testing, so every workspace audits against the same rule config.",
  },
];

const librariesAwayFrom = (home) =>
  [...appLibraries, ...testSupportLibraries].filter((library) => library.home !== home).map(({ group, message }) => ({ group, message }));

const theIconsModule = "packages/ui/src/icons.ts";

const theUiPrimitivesHome = "packages/ui/src/primitives";

const lucideReactHomes = [theIconsModule, theUiPrimitivesHome];

const lucideReactMessage =
  "Icons come only from lucide, through @qp/ui/icons ([[2-design-doc#17. Decisions Log]] #85). A primitive that needs one directly may still import lucide-react itself ([[11-structural-refactor]] L2).";

const lucideReactOutsideItsHomes = { group: ["lucide-react", "lucide-react/*"], message: lucideReactMessage };

const restrictOutside = (home, ...patterns) => [
  "error",
  { patterns: [telemetryOnly, ...(lucideReactHomes.includes(home) ? [] : [lucideReactOutsideItsHomes]), ...librariesAwayFrom(home), ...patterns] },
];

const restrict = (...patterns) => restrictOutside(undefined, ...patterns);

const noDefaultExport = {
  selector: "ExportDefaultDeclaration",
  message:
    "Exports are named, so an import reads the same everywhere. Tool config files and the vitest and Playwright globalSetup and globalTeardown entry points are the exception, because those tools load a default export.",
};

const routePathLiteral = {
  selector: "Literal[regex.pattern=/(^|\\/):\\(/]",
  message:
    "Route paths are filled in by routePath in packages/shared/src/api/request.ts, which is the one place that knows the `:param` syntax. Import it instead of matching `:param` with a regex.",
};

const unnamedReExport = {
  selector: "ExportAllDeclaration[exported=null]",
  message:
    "`export *` re-exports whatever the other module happens to export, so an entry point's API grows without anyone naming it. List the names; `export * as namespace` is fine, because it adds one named export.",
};

const noSvgJsx = {
  selector: 'JSXOpeningElement[name.name="svg"]',
  message:
    "An <svg> is drawn only inside packages/ui, through @qp/ui/icons or a primitive. Import the icon component instead of hand-drawing one ([[11-structural-refactor]] L2).",
};

const sharedVocabularyNames = [
  "QuestionOf",
  "strict",
  "OTHER_OPTION_ID",
  "optionIdsOf",
  "freeformOptionOf",
  "conditionsOf",
  "referencedOptionIds",
  "OPERATORS_BY_TYPE",
  "isChoiceQuestion",
  "draftItemOf",
  "draftForValidation",
  "questionInputOf",
];

const sharedVocabulary = ["TSTypeAliasDeclaration", "VariableDeclarator", "FunctionDeclaration"].map((declaration) => ({
  selector: `${declaration}[id.name=/^(${sharedVocabularyNames.join("|")})$/]`,
  message:
    "This name is shared vocabulary, declared once in packages/shared/src/domain or packages/shared/src/primitives.ts. Import it from @qp/shared; a local copy drifts, as the three definitions of the \"other\" option did ([[2-design-doc#17. Decisions Log]] #82).",
}));

const syntaxOutsideTheRoutePathHelper = [...doubleAssertions, routePathLiteral, unnamedReExport];

const syntaxDeclaringTheSharedVocabulary = (...selectors) => ["warn", ...syntaxOutsideTheRoutePathHelper, noDefaultExport, ...selectors];

const syntaxAllowingDefaultExport = (...selectors) => ["warn", ...syntaxOutsideTheRoutePathHelper, ...sharedVocabulary, ...selectors];

const syntax = (...selectors) => syntaxAllowingDefaultExport(noDefaultExport, ...selectors);

const syntaxInsideTheRoutePathHelper = (...selectors) => [
  "warn",
  ...syntaxOutsideTheRoutePathHelper.filter((selector) => selector !== routePathLiteral),
  noDefaultExport,
  ...sharedVocabulary,
  ...selectors,
];

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

const backendNotFoundMessage =
  "The `resource/not-found` body is built only by notFoundProblem in apps/backend/src/http/problems.ts, so every 404 carries the same members. Call it instead.";

const notFoundInTheBackend = {
  selector: 'CallExpression[callee.name="problem"][arguments.0.value="resource/not-found"]',
  message: backendNotFoundMessage,
};

const notFoundOutsideNotFoundProblem = {
  selector:
    'CallExpression[callee.name="problem"][arguments.0.value="resource/not-found"]:not(FunctionDeclaration[id.name="notFoundProblem"] *)',
  message: backendNotFoundMessage,
};

const theNotFoundBuilder = "apps/backend/src/http/problems.ts";

const sourcesOutsideTheBackend = ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}", "e2e/**/*.{ts,tsx}"];

const theProblemParser = "packages/shared/src/problems.ts";

const theRoutePathHelper = "packages/shared/src/api/request.ts";

const rawSqlMessage =
  "Raw SQL through drizzle's `sql` bypasses the query builder's types. Use the builder (eq, and, exists, notExists, max, inArray, …); if Postgres needs something the builder cannot express, such as calling a database function or DDL, disable it with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>";

const rawSql = [
  { selector: 'TaggedTemplateExpression[tag.type="Identifier"][tag.name="sql"]', message: rawSqlMessage },
  { selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="sql"]', message: rawSqlMessage },
];

const relativeImportHasExtensionMessage =
  "Vite and Playwright resolve a relative import themselves, so this workspace's specifiers carry no extension ([[11-structural-refactor]] L13).";

const relativeImportHasExtension = [
  {
    selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/]",
    message: relativeImportHasExtensionMessage,
  },
];

const relativeImportMissingJsExtensionMessage =
  "This workspace compiles for Node with tsc, which requires the compiled .js extension on a relative import even though the source is .ts ([[11-structural-refactor]] L13).";

const relativeImportMissingJsExtension = [
  {
    selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).*$/]",
    message: relativeImportMissingJsExtensionMessage,
  },
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

const transportSeamMessage =
  "fetch belongs to an app's API client (apps/*/src/api/**) or to the e2e fixtures and stack, so one module per app owns the transport that trace headers and client spans will attach to.";

const fetchAwayFromTheTransport = { name: "fetch", message: transportSeamMessage };

const fetchThroughAnObject = ["window", "globalThis"].map((object) => ({ object, property: "fetch", message: transportSeamMessage }));

const persistenceSeamMessage =
  "The respondent reads and writes partial answers through apps/respondent/src/storage, so the envelope format, the quota and failure handling, and later the telemetry around them live in one seam.";

const localStorageAwayFromTheSeam = { name: "localStorage", message: persistenceSeamMessage };

const localStorageThroughAnObject = ["window", "globalThis"].map((object) => ({
  object,
  property: "localStorage",
  message: persistenceSeamMessage,
}));

const environmentSeamMessage =
  "The backend reads process.env once, in apps/backend/src/config.ts, so every setting has one name, one default and one place for telemetry configuration to land. Tool config files read the environment directly; application code takes what it needs from config.ts.";

const processEnvAwayFromTheReader = [{ object: "process", property: "env", message: environmentSeamMessage }];

const theEnvironmentReader = "apps/backend/src/config.ts";

const theStorageSeam = "apps/respondent/src/storage/**";

const terminalEntryPoints = [
  "apps/backend/src/db/migrate.ts",
  "apps/backend/src/db/seed/seed.ts",
  "e2e/stack/stack-cli.ts",
  "e2e/stack/global-setup.ts",
  "e2e/stack/global-teardown.ts",
];

const theToolConfigFiles = ["**/*.config.{ts,tsx,mts,cts,js,mjs,cjs}"];

const filesThatMustDefaultExport = [
  ...theToolConfigFiles,
  "apps/backend/_tests/db/global-setup.ts",
  "e2e/stack/global-setup.ts",
  "e2e/stack/global-teardown.ts",
];

const backendFilesThatMustDefaultExport = ["apps/backend/**/*.config.{ts,tsx,mts,cts,js,mjs,cjs}"];

const harnessFile = "harness(\\.[cm]?[jt]sx?)?$";

const anotherDirectorysHarness = {
  regex: `^(?!\\./+[^/.][^/]*/+${harnessFile})(\\.{1,2}/+)+([^/]+/+)*?[^/.][^/]*/+${harnessFile}`,
  message:
    "A harness serves its own directory: the tests beside it, below it, and the test named after it one level up. Helpers other directories share live in support modules — apps/admin/_tests/support, a backend fixtures.ts, or @qp/ui/testing.",
};

const testSupportLibrariesAway = testSupportLibraries.map(({ group, message }) => ({ group, message }));

const testSupportMessage =
  "@qp/ui/testing is test support: it stubs fetch with vitest and runs axe-core. Production code never imports it; tests do, from _tests/.";

const theTestSupportPackage = { group: ["@qp/ui/testing", "@qp/ui/testing/*"], message: testSupportMessage };

const theTestSupportDirectory = { regex: "^(\\.{1,2}/+)+([^/]+/+)*testing(/|$)", message: testSupportMessage };

const uiEntryPoints = ["questionnaire", "testing", "icons"];

const uiInternalsMessage =
  "Apps reach @qp/ui only through the entry points packages/ui/package.json declares in its exports map. A relative path into packages/ui/src, or a bare import deeper than a single-file entry such as ./questionnaire, reaches past what the package exports.";

const uiInternalsByRelativePath = {
  regex: `(^|/)packages${pathGap}ui${pathGap}src(/|$)`,
  message: uiInternalsMessage,
};

const uiInternalsPastASingleFileEntry = {
  regex: `^@qp/ui/(${uiEntryPoints.join("|")})/.+`,
  message: uiInternalsMessage,
};

const e2eFilesThatMustDefaultExport = [
  "e2e/**/*.config.{ts,tsx,mts,cts,js,mjs,cjs}",
  "e2e/stack/global-setup.ts",
  "e2e/stack/global-teardown.ts",
];

const proseCommentMessage =
  "Comments are forbidden here (AGENTS.md, No comments): rename, extract or encode the constraint in a type instead, and put a decision's reasoning in docs/. The exceptions are ESLint directives (eslint-disable, eslint-disable-next-line, eslint-disable-line, eslint-enable, eslint-env) and `@ts-expect-error — <reason>` in type-level tests.";

const tsExpectErrorWithReason = /^@ts-expect-error\s+—\s+\S/;

const eslintDirectivePrefixes = ["eslint-disable-next-line", "eslint-disable-line", "eslint-disable", "eslint-enable", "eslint-env"];

function isAllowedDirectiveComment(value) {
  const text = value.trim();
  return eslintDirectivePrefixes.some((prefix) => text.startsWith(prefix)) || tsExpectErrorWithReason.test(text);
}

const noProseComments = {
  rules: {
    "no-prose-comments": {
      meta: { type: "problem", docs: { description: proseCommentMessage } },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (isAllowedDirectiveComment(comment.value)) continue;
              context.report({ loc: comment.loc, message: proseCommentMessage });
            }
          },
        };
      },
    },
  },
};

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
    name: "library split by app: admin, alongside L12",
    files: ["apps/admin/**"],
    rules: { "no-restricted-imports": restrictOutside("apps/admin", uiInternalsByRelativePath, uiInternalsPastASingleFileEntry) },
  },
  {
    name: "library split by app: respondent, alongside L12",
    files: ["apps/respondent/**"],
    rules: { "no-restricted-imports": restrictOutside("apps/respondent", uiInternalsByRelativePath, uiInternalsPastASingleFileEntry) },
  },
  {
    name: "library split by app: the shared primitives",
    files: ["packages/ui/src/primitives/**"],
    rules: { "no-restricted-imports": restrictOutside(theUiPrimitivesHome) },
  },
  {
    name: "L2: lucide-react inside the icons module, one of its two homes",
    files: [theIconsModule],
    rules: { "no-restricted-imports": restrictOutside(theIconsModule) },
  },
  ...privateAdminScreens.map((name) => ({
    name: `L3: screens/${name}'s own files, which may reach the other private screens but stay outside them`,
    files: screenOwnPaths(name),
    rules: {
      "no-restricted-imports": restrictOutside(
        "apps/admin",
        uiInternalsByRelativePath,
        uiInternalsPastASingleFileEntry,
        mutationsOutsideTheirHome,
        ...privateAdminScreens.filter((other) => other !== name).map(screenIsPrivate),
      ),
    },
  })),
  {
    name: "L4: mutations stay allowed inside src/api/mutations, which never imports screens/ either",
    files: ["apps/admin/src/api/mutations/**"],
    rules: {
      "no-restricted-imports": restrictOutside(
        "apps/admin",
        uiInternalsByRelativePath,
        uiInternalsPastASingleFileEntry,
        screensAreDownstream,
      ),
    },
  },
  {
    name: "L3: lib, components, api and features never import screens/, whether a private subdirectory or a screen's own top-level file",
    files: ["apps/admin/src/{lib,components,api,features}/**"],
    ignores: ["apps/admin/src/api/mutations/**"],
    rules: {
      "no-restricted-imports": restrictOutside(
        "apps/admin",
        uiInternalsByRelativePath,
        uiInternalsPastASingleFileEntry,
        mutationsOutsideTheirHome,
        screensAreDownstream,
      ),
    },
  },
  {
    name: "L3 and L4: a screen with no private subdirectory of its own still keeps the other screens' out, and mutations live in src/api/mutations",
    files: ["apps/admin/**"],
    ignores: [
      ...allPrivateScreenPaths,
      "apps/admin/src/{lib,components,api,features}/**",
      "apps/admin/_tests/**",
    ],
    rules: {
      "no-restricted-imports": restrictOutside(
        "apps/admin",
        uiInternalsByRelativePath,
        uiInternalsPastASingleFileEntry,
        mutationsOutsideTheirHome,
        ...privateAdminScreens.map(screenIsPrivate),
      ),
    },
  },
  {
    name: "L16: fetch outside the API clients, the e2e fixtures and the e2e stack",
    files: everyFile,
    ignores: fetchOwners,
    rules: {
      "no-restricted-globals": confine(fetchAwayFromTheTransport),
      "no-restricted-properties": ["error", ...fetchThroughAnObject],
    },
  },
  {
    name: "L16, L17 and L18: fetch, localStorage and process.env in the sources that own none of them",
    files: everySourceFile,
    ignores: [...apiClients, theStorageSeam, theEnvironmentReader],
    rules: {
      "no-restricted-globals": confine(fetchAwayFromTheTransport, localStorageAwayFromTheSeam),
      "no-restricted-properties": ["error", ...fetchThroughAnObject, ...localStorageThroughAnObject, ...processEnvAwayFromTheReader],
    },
  },
  {
    name: "L17 and L18: localStorage and process.env inside the API clients, which own the transport and neither of the other two",
    files: apiClients,
    rules: {
      "no-restricted-globals": confine(localStorageAwayFromTheSeam),
      "no-restricted-properties": ["error", ...localStorageThroughAnObject, ...processEnvAwayFromTheReader],
    },
  },
  {
    name: "L16 and L18: fetch and process.env inside the respondent's persistence seam, which owns localStorage and neither of the other two",
    files: [theStorageSeam],
    rules: {
      "no-restricted-globals": confine(fetchAwayFromTheTransport),
      "no-restricted-properties": ["error", ...fetchThroughAnObject, ...processEnvAwayFromTheReader],
    },
  },
  {
    name: "L18: the environment reader itself, which owns process.env and neither of the other two seams",
    files: [theEnvironmentReader],
    rules: {
      "no-restricted-globals": confine(fetchAwayFromTheTransport, localStorageAwayFromTheSeam),
      "no-restricted-properties": ["error", ...fetchThroughAnObject, ...localStorageThroughAnObject],
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
    name: "L10: problem bodies in the frontends, the shared packages and e2e",
    files: sourcesOutsideTheBackend,
    ignores: ["apps/backend/src/**", theProblemParser, "packages/ui/src/**"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx) },
  },
  {
    name: "L2 and L10: packages/ui draws <svg> and parses problem bodies without the outside restrictions",
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem) },
  },
  {
    name: "L21: dates are formatted only in admin's src/lib/dates.ts",
    files: ["apps/admin/src/**/*.{ts,tsx}"],
    ignores: [adminDatesHome],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx, ...dateFormatting) },
  },
  {
    name: "L10: problem bodies in the e2e entry points, which must default-export",
    files: e2eFilesThatMustDefaultExport,
    rules: { "no-restricted-syntax": syntaxAllowingDefaultExport(...problemParsing, notFoundProblem) },
  },
  {
    name: "L6: routePath owns the :param syntax",
    files: [theRoutePathHelper],
    rules: { "no-restricted-syntax": syntaxInsideTheRoutePathHelper(...problemParsing, notFoundProblem) },
  },
  {
    name: "L9: the shared vocabulary's own declarations",
    files: ["packages/shared/src/primitives.ts", "packages/shared/src/domain/**"],
    rules: { "no-restricted-syntax": syntaxDeclaringTheSharedVocabulary(...problemParsing, notFoundProblem) },
  },
  {
    name: "L15: no explicit any",
    files: everyFile,
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  {
    name: "L10: resource/not-found in the backend, built only by notFoundProblem, alongside its raw SQL and connection restrictions",
    files: ["apps/backend/src/**/*.ts"],
    ignores: ["apps/backend/src/db/schema.ts", "apps/backend/src/db/client.ts", theNotFoundBuilder],
    rules: {
      "no-restricted-syntax": syntax(...rawSql, ...connectionConstruction, ...problemParsing, notFoundInTheBackend),
    },
  },
  {
    name: "L10: resource/not-found in the schema declaration, whose checks and defaults are SQL expressions",
    files: ["apps/backend/src/db/schema.ts"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundInTheBackend) },
  },
  {
    name: "L10: resource/not-found in the connection constructor, which constructs connections",
    files: ["apps/backend/src/db/client.ts"],
    rules: { "no-restricted-syntax": syntax(...rawSql, ...problemParsing, notFoundInTheBackend) },
  },
  {
    name: "L10: resource/not-found inside notFoundProblem, its one builder",
    files: [theNotFoundBuilder],
    rules: {
      "no-restricted-syntax": syntax(...rawSql, ...connectionConstruction, ...problemParsing, notFoundOutsideNotFoundProblem),
    },
  },
  {
    name: "L11: axe inside @qp/ui/testing",
    files: ["packages/ui/src/testing/**"],
    rules: { "no-restricted-imports": restrictOutside("packages/ui/src/testing") },
  },
  {
    name: "L11: harness imports in every _tests directory",
    files: ["**/_tests/**"],
    rules: { "no-restricted-imports": restrict(anotherDirectorysHarness) },
  },
  {
    name: "L11 and L12: harness imports in admin's tests, alongside its library split",
    files: ["apps/admin/_tests/**"],
    rules: {
      "no-restricted-imports": restrictOutside("apps/admin", anotherDirectorysHarness, uiInternalsByRelativePath, uiInternalsPastASingleFileEntry),
    },
  },
  {
    name: "L11 and L12: harness imports in the respondent's tests, alongside its library split",
    files: ["apps/respondent/_tests/**"],
    rules: {
      "no-restricted-imports": restrictOutside(
        "apps/respondent",
        anotherDirectorysHarness,
        uiInternalsByRelativePath,
        uiInternalsPastASingleFileEntry,
      ),
    },
  },
  {
    name: "L11: harness imports in backend tests, alongside the openDatabase restriction",
    files: ["apps/backend/_tests/**/*.ts"],
    ignores: ["apps/backend/_tests/db/harness.ts"],
    rules: { "no-restricted-imports": restrict(openDatabaseOutsideTheHarness, anotherDirectorysHarness) },
  },
  {
    name: "L11: axe inside packages/telemetry, which may import pino and OpenTelemetry",
    files: ["packages/telemetry/**"],
    rules: { "no-restricted-imports": ["error", { patterns: testSupportLibrariesAway }] },
  },
  {
    name: "L11: axe and harness imports in the telemetry tests",
    files: ["packages/telemetry/_tests/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [...testSupportLibrariesAway, anotherDirectorysHarness] }] },
  },
  {
    name: "L11: @qp/ui/testing stays out of production code",
    files: everySourceFile,
    ignores: ["packages/ui/src/testing/**"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [theTestSupportPackage] }] },
  },
  {
    name: "L11: packages/ui/src reaches its testing directory by neither name",
    files: ["packages/ui/src/**"],
    ignores: ["packages/ui/src/testing/**"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [theTestSupportPackage, theTestSupportDirectory] }] },
  },
  {
    name: "L5: no prose comments",
    files: everyFile,
    ignores: theToolConfigFiles,
    plugins: { local: noProseComments },
    rules: { "local/no-prose-comments": "error" },
  },
  {
    name: "L13: backend sources require the compiled .js extension",
    files: ["apps/backend/src/**/*.ts"],
    ignores: ["apps/backend/src/db/schema.ts", "apps/backend/src/db/client.ts", theNotFoundBuilder],
    rules: {
      "no-restricted-syntax": syntax(...rawSql, ...connectionConstruction, ...problemParsing, notFoundInTheBackend, ...relativeImportMissingJsExtension),
    },
  },
  {
    name: "L13: the schema declaration requires the compiled .js extension",
    files: ["apps/backend/src/db/schema.ts"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundInTheBackend, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: the connection constructor requires the compiled .js extension",
    files: ["apps/backend/src/db/client.ts"],
    rules: { "no-restricted-syntax": syntax(...rawSql, ...problemParsing, notFoundInTheBackend, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: notFoundProblem's own file requires the compiled .js extension",
    files: [theNotFoundBuilder],
    rules: {
      "no-restricted-syntax": syntax(...rawSql, ...connectionConstruction, ...problemParsing, notFoundOutsideNotFoundProblem, ...relativeImportMissingJsExtension),
    },
  },
  {
    name: "L13: backend tests require the compiled .js extension",
    files: ["apps/backend/_tests/**/*.ts"],
    ignores: ["apps/backend/_tests/db/harness.ts", "apps/backend/_tests/db/global-setup.ts"],
    rules: { "no-restricted-syntax": syntax(...rawSql, ...connectionConstruction, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: the test harness that constructs connections requires the compiled .js extension",
    files: ["apps/backend/_tests/db/harness.ts"],
    rules: { "no-restricted-syntax": syntax(...rawSql, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: the test harness's globalSetup requires the compiled .js extension, alongside its default export",
    files: ["apps/backend/_tests/db/global-setup.ts"],
    rules: { "no-restricted-syntax": syntaxAllowingDefaultExport(...rawSql, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: packages/shared sources require the compiled .js extension",
    files: ["packages/shared/src/**/*.ts"],
    ignores: [theRoutePathHelper, theProblemParser, "packages/shared/src/primitives.ts", "packages/shared/src/domain/**"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: the problem parser's own file requires the compiled .js extension, exempt from L10 like every other selector it inherits",
    files: [theProblemParser],
    rules: { "no-restricted-syntax": syntax(...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: the route path helper requires the compiled .js extension",
    files: [theRoutePathHelper],
    rules: { "no-restricted-syntax": syntaxInsideTheRoutePathHelper(...problemParsing, notFoundProblem, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: the shared vocabulary's own declarations require the compiled .js extension",
    files: ["packages/shared/src/primitives.ts", "packages/shared/src/domain/**"],
    rules: { "no-restricted-syntax": syntaxDeclaringTheSharedVocabulary(...problemParsing, notFoundProblem, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: packages/shared tests require the compiled .js extension",
    files: ["packages/shared/_tests/**/*.ts"],
    rules: { "no-restricted-syntax": syntax(...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: packages/telemetry sources require the compiled .js extension",
    files: ["packages/telemetry/src/**/*.ts"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx, ...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: packages/telemetry tests require the compiled .js extension",
    files: ["packages/telemetry/_tests/**/*.ts"],
    rules: { "no-restricted-syntax": syntax(...relativeImportMissingJsExtension) },
  },
  {
    name: "L13: admin sources carry no extension, Vite resolves them",
    files: ["apps/admin/src/**/*.{ts,tsx}"],
    ignores: [adminDatesHome],
    rules: {
      "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx, ...dateFormatting, ...relativeImportHasExtension),
    },
  },
  {
    name: "L13: admin's own date formatter carries no extension, Vite resolves it",
    files: [adminDatesHome],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx, ...relativeImportHasExtension) },
  },
  {
    name: "L13: admin tests carry no extension, Vite resolves them",
    files: ["apps/admin/_tests/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": syntax(...relativeImportHasExtension) },
  },
  {
    name: "L13: respondent sources carry no extension, Vite resolves them",
    files: ["apps/respondent/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx, ...relativeImportHasExtension) },
  },
  {
    name: "L13: respondent tests carry no extension, Vite resolves them",
    files: ["apps/respondent/_tests/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": syntax(...relativeImportHasExtension) },
  },
  {
    name: "L13: packages/ui sources carry no extension, Vite resolves them, alongside L2 and L10",
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, ...relativeImportHasExtension) },
  },
  {
    name: "L13: packages/ui tests carry no extension, Vite resolves them",
    files: ["packages/ui/_tests/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": syntax(...relativeImportHasExtension) },
  },
  {
    name: "L13: e2e fixtures and specs carry no extension, Playwright resolves them; e2e/stack is a plain Node CLI and keeps its extensions",
    files: ["e2e/fixtures/**/*.ts", "e2e/specs/**/*.ts"],
    rules: { "no-restricted-syntax": syntax(...problemParsing, notFoundProblem, noSvgJsx, ...relativeImportHasExtension) },
  },
);
