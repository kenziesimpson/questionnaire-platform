const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_LENGTH = 8;

export function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function generateUnusedId(prefix: string, taken: ReadonlySet<string>, suffix: () => string = randomSuffix): string {
  for (;;) {
    const candidate = `${prefix}${suffix()}`;
    if (!taken.has(candidate)) return candidate;
  }
}
