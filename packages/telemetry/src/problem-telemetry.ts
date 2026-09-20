import type { Problem } from "@qp/shared";
import type { TelemetryContext } from "./fields.js";
import { guardedOr } from "./guard.js";
import { projectProblem } from "./problems.js";

export function problemTelemetry(body: Problem): readonly TelemetryContext[] {
  return guardedOr<readonly TelemetryContext[]>("log", [], () => projectProblem(body));
}
