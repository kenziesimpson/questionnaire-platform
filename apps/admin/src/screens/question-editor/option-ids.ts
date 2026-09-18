import { generateUnusedId, randomSuffix } from "../../components/generated-id";

export const YES_OPTION_ID = "yes";
export const NO_OPTION_ID = "no";

const GENERATED_PREFIX = "opt_";

export function generateOptionId(taken: ReadonlySet<string>, suffix: () => string = randomSuffix): string {
  return generateUnusedId(GENERATED_PREFIX, taken, suffix);
}
