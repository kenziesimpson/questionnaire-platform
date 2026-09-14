// ESLint carries the repo's import boundaries plus the React hooks rules for the TSX workspaces.
// The boundaries are two rule families, both `no-restricted-imports`
// ([[7-application-boundary]] §3.1, [[6-observability]] §3.1):
//
//   1. Only packages/telemetry may import pino or OpenTelemetry.
//   2. The backend's definition and execution modules may not import each other, execution may not
//      import the definition side of the db layer, and db/definition may not import any module.
//
// `no-restricted-imports` is configured once per file, so a later block replaces an earlier one's
// options rather than merging; each block therefore restates the telemetry patterns it inherits.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

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

const restrict = (...patterns) => ["error", { patterns }];

const doubleAssertionThrough = (keyword, spelling) =>
  ["TSAsExpression", "TSTypeAssertion"].map((inner) => ({
    selector: `TSAsExpression > ${inner}.expression[typeAnnotation.type="${keyword}"]`,
    message: `Casting through \`${spelling}\` compiles for any two types and switches type checking off. Fix the types; if the cast is genuinely unavoidable, disable this line with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>`,
  }));

const doubleAssertions = [...doubleAssertionThrough("TSUnknownKeyword", "unknown"), ...doubleAssertionThrough("TSAnyKeyword", "any")];

const rawSqlMessage =
  "Raw SQL through drizzle's `sql` bypasses the query builder's types. Use the builder (eq, and, exists, notExists, max, inArray, …); if Postgres needs something the builder cannot express, such as calling a database function or DDL, disable it with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>";

const rawSql = [
  { selector: 'TaggedTemplateExpression[tag.type="Identifier"][tag.name="sql"]', message: rawSqlMessage },
  { selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="sql"]', message: rawSqlMessage },
];

const noDoubleAssertion = ["warn", ...doubleAssertions];
const noDoubleAssertionOrRawSql = ["warn", ...doubleAssertions, ...rawSql];

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: { "no-restricted-imports": restrict(telemetryOnly), "no-restricted-syntax": noDoubleAssertion },
  },
  {
    files: ["packages/telemetry/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["apps/backend/**/*.ts"],
    ignores: ["apps/backend/src/db/schema.ts"],
    rules: { "no-restricted-syntax": noDoubleAssertionOrRawSql },
  },
  {
    files: ["apps/backend/src/modules/definition/**"],
    rules: { "no-restricted-imports": restrict(telemetryOnly, otherModule("execution")) },
  },
  {
    files: ["apps/backend/src/modules/execution/**"],
    rules: { "no-restricted-imports": restrict(telemetryOnly, otherModule("definition"), definitionDbLayer) },
  },
  {
    files: ["apps/backend/src/db/definition/**"],
    rules: { "no-restricted-imports": restrict(telemetryOnly, anyModule) },
  },
  {
    ...reactHooks.configs.flat.recommended,
    files: reactWorkspaces,
  },
);
