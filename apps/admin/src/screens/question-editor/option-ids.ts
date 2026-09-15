export const YES_OPTION_ID = "yes";
export const NO_OPTION_ID = "no";
export const OTHER_OPTION_ID = "other";

const GENERATED_PREFIX = "opt_";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_LENGTH = 8;

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function generateOptionId(taken: ReadonlySet<string>, suffix: () => string = randomSuffix): string {
  for (;;) {
    const candidate = `${GENERATED_PREFIX}${suffix()}`;
    if (!taken.has(candidate)) return candidate;
  }
}
