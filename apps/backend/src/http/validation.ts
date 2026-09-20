import AjvCompiler from "@fastify/ajv-compiler";
import type { PointerError } from "@qp/shared";
import type { FastifySchemaCompiler, FastifySchemaValidationError } from "fastify";

const URL_PARTS: ReadonlySet<string> = new Set(["params", "querystring"]);

function ajvSchemaCompiler(coerceTypes: boolean): FastifySchemaCompiler<unknown> {
  const buildAjvCompiler = AjvCompiler();
  // eslint-disable-next-line no-restricted-syntax -- @fastify/ajv-compiler's .d.ts types the compiled function as (schema) => validate, but at runtime it receives Fastify's route definition and reads .schema from it
  return buildAjvCompiler({}, { customOptions: { coerceTypes, removeAdditional: false } }) as unknown as FastifySchemaCompiler<unknown>;
}

const NUL = "\u0000";

function pointerToNulIn(root: unknown): string | undefined {
  const pending: { readonly value: unknown; readonly path: string }[] = [{ value: root, path: "" }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { value, path } = next;
    if (typeof value === "string" && value.includes(NUL)) return path;
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => pending.push({ value: item, path: `${path}/${index}` }));
    } else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        if (key.includes(NUL)) return path;
        pending.push({ value: item, path: `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}` });
      }
    }
  }
  return undefined;
}

function errorsOf(validate: object): FastifySchemaValidationError[] {
  return "errors" in validate && Array.isArray(validate.errors) ? validate.errors : [];
}

function refusingNul(compiler: FastifySchemaCompiler<unknown>): FastifySchemaCompiler<unknown> {
  return (route) => {
    const validate = compiler(route);
    return (data) => {
      const at = pointerToNulIn(data);
      if (at !== undefined) {
        const error: FastifySchemaValidationError = { keyword: "pattern", instancePath: at, schemaPath: "#/nul", params: {}, message: "must not contain a null character" };
        return { error: [error] };
      }
      const outcome = validate(data);
      return outcome === false ? { error: errorsOf(validate) } : outcome;
    };
  };
}

export function requestValidatorCompiler(): FastifySchemaCompiler<unknown> {
  const exact = ajvSchemaCompiler(false);
  const coercingUrlStrings = ajvSchemaCompiler(true);
  return refusingNul((route) => (URL_PARTS.has(route.httpPart ?? "") ? coercingUrlStrings(route) : exact(route)));
}

function pointerOf(part: string, error: FastifySchemaValidationError): string {
  const params = error.params as { missingProperty?: unknown; additionalProperty?: unknown };
  const child = error.keyword === "required" ? params.missingProperty : error.keyword === "additionalProperties" ? params.additionalProperty : undefined;
  const suffix = typeof child === "string" ? `/${child.replaceAll("~", "~0").replaceAll("/", "~1")}` : "";
  return `/${part}${error.instancePath}${suffix}`;
}

function isInsideFailedUnion(error: FastifySchemaValidationError, unionPaths: readonly string[]): boolean {
  return (
    error.keyword !== "anyOf" &&
    unionPaths.some((path) => error.instancePath === path || error.instancePath.startsWith(`${path}/`))
  );
}

export function pointerErrors(part: string, validation: readonly FastifySchemaValidationError[]): PointerError[] {
  const unionPaths = validation.filter((error) => error.keyword === "anyOf").map((error) => error.instancePath);
  const unique = new Map<string, PointerError>();
  for (const error of validation) {
    if (isInsideFailedUnion(error, unionPaths)) continue;
    const entry: PointerError = { pointer: pointerOf(part, error), code: `schema/${error.keyword}` };
    unique.set(`${entry.pointer} ${entry.code}`, entry);
  }
  return [...unique.values()];
}
