// ESLint carries the repo's import boundaries plus the React hooks rules for the TSX workspaces.
// The boundaries are two rule families, both `no-restricted-imports`
// ([[7-application-boundary]] §3.1, [[6-observability]] §3.1):
//
//   1. Only packages/telemetry may import pino or OpenTelemetry.
//   2. The backend's definition and execution modules may not import each other.
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

function otherModule(name) {
  return {
    regex: `(^|/)modules/${name}(/|$)|^(\\.\\./)+${name}(/|$)`,
    message: `The definition and execution modules share nothing but @qp/shared. Importing modules/${name} crosses the boundary.`,
  };
}

const restrict = (...patterns) => ["error", { patterns }];

const doubleAssertionThrough = (keyword, spelling) =>
  ["TSAsExpression", "TSTypeAssertion"].map((inner) => ({
    selector: `TSAsExpression > ${inner}.expression[typeAnnotation.type="${keyword}"]`,
    message: `Casting through \`${spelling}\` compiles for any two types and switches type checking off. Fix the types; if the cast is genuinely unavoidable, disable this line with a reason: // eslint-disable-next-line no-restricted-syntax -- <reason>`,
  }));

const noDoubleAssertion = ["warn", ...doubleAssertionThrough("TSUnknownKeyword", "unknown"), ...doubleAssertionThrough("TSAnyKeyword", "any")];

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
    files: ["apps/backend/src/modules/definition/**"],
    rules: { "no-restricted-imports": restrict(telemetryOnly, otherModule("execution")) },
  },
  {
    files: ["apps/backend/src/modules/execution/**"],
    rules: { "no-restricted-imports": restrict(telemetryOnly, otherModule("definition")) },
  },
  {
    ...reactHooks.configs.flat.recommended,
    files: reactWorkspaces,
  },
);
