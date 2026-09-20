export interface RateLimit {
  readonly max: number;
  readonly windowMs: number;
}

interface RateVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface Bucket {
  readonly startedAt: number;
  count: number;
}

const MAX_TRACKED_KEYS = 10_000;

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

const IPV6_GROUPS = 8;

const IPV6_PREFIX_GROUPS = 4;

function expandedGroups(address: string): string[] {
  const [head = "", tail] = address.split("::");
  const headGroups = head === "" ? [] : head.split(":");
  if (tail === undefined) return headGroups;
  const tailGroups = tail === "" ? [] : tail.split(":");
  const zeros = Array.from({ length: Math.max(0, IPV6_GROUPS - headGroups.length - tailGroups.length) }, () => "0");
  return [...headGroups, ...zeros, ...tailGroups];
}

function bucketKeyOf(address: string): string {
  const unscoped = address.split("%", 1)[0] ?? address;
  const mapped = IPV4_MAPPED.exec(unscoped)?.[1];
  if (mapped !== undefined) return mapped;
  if (!unscoped.includes(":")) return unscoped;
  const prefix = expandedGroups(unscoped.toLowerCase()).slice(0, IPV6_PREFIX_GROUPS);
  return `${prefix.map((group) => group.padStart(4, "0")).join(":")}::/64`;
}

export class RateLimiter {
  readonly #limit: RateLimit;
  readonly #now: () => number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(limit: RateLimit, now: () => number) {
    this.#limit = limit;
    this.#now = now;
  }

  admit(address: string): RateVerdict {
    const key = bucketKeyOf(address);
    const at = this.#now();
    const existing = this.#buckets.get(key);
    const bucket = existing !== undefined && at - existing.startedAt < this.#limit.windowMs ? existing : this.#open(key, at);
    bucket.count += 1;
    if (bucket.count <= this.#limit.max) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + this.#limit.windowMs - at) / 1000)) };
  }

  #open(key: string, at: number): Bucket {
    this.#buckets.delete(key);
    if (this.#buckets.size >= MAX_TRACKED_KEYS) {
      this.#evictOldest();
    }
    const opened: Bucket = { startedAt: at, count: 0 };
    this.#buckets.set(key, opened);
    return opened;
  }

  #evictOldest(): void {
    const oldest = this.#buckets.keys().next();
    if (oldest.done !== true) {
      this.#buckets.delete(oldest.value);
    }
  }
}
