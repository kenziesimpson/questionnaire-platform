import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../../src/modules/telemetry/rate-limit.js";

function limiterAt(max: number, windowMs: number) {
  const clock = { now: 0 };
  return { clock, limiter: new RateLimiter({ max, windowMs }, () => clock.now) };
}

describe("RateLimiter", () => {
  it("admits up to the maximum in a window and refuses the rest, naming the seconds until the window ends", () => {
    const { clock, limiter } = limiterAt(2, 60_000);

    expect(limiter.admit("a")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.admit("a")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    clock.now = 15_500;
    expect(limiter.admit("a")).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it("tells a caller who is refused to wait at least a second", () => {
    const { clock, limiter } = limiterAt(1, 60_000);
    limiter.admit("a");

    clock.now = 59_999;

    expect(limiter.admit("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("counts each key on its own", () => {
    const { limiter } = limiterAt(1, 60_000);

    expect(limiter.admit("a").allowed).toBe(true);
    expect(limiter.admit("b").allowed).toBe(true);
    expect(limiter.admit("a").allowed).toBe(false);
    expect(limiter.admit("b").allowed).toBe(false);
  });

  it("admits again once the window has passed", () => {
    const { clock, limiter } = limiterAt(1, 60_000);
    limiter.admit("a");
    expect(limiter.admit("a").allowed).toBe(false);

    clock.now = 60_000;

    expect(limiter.admit("a").allowed).toBe(true);
  });

  it("stays bounded under a flood of distinct keys by evicting the oldest, so recent keys stay limited", () => {
    const { limiter } = limiterAt(1, 60_000);
    limiter.admit("10.0.0.1");
    for (let index = 0; index < 10_000; index += 1) limiter.admit(`192.0.2.${index}`);

    expect(limiter.admit("192.0.2.9999").allowed).toBe(false);
    expect(limiter.admit("192.0.2.9998").allowed).toBe(false);
    expect(limiter.admit("10.0.0.1").allowed).toBe(true);
    expect(limiter.admit("fresh").allowed).toBe(true);
    expect(limiter.admit("fresh").allowed).toBe(false);
  });

  it("keeps a key that reopens its window at the young end of the eviction order", () => {
    const { clock, limiter } = limiterAt(1, 60_000);
    limiter.admit("a");
    for (let index = 0; index < 9_998; index += 1) limiter.admit(`k${index}`);
    clock.now = 60_000;
    limiter.admit("a");
    limiter.admit("late-1");
    limiter.admit("late-2");

    expect(limiter.admit("a").allowed).toBe(false);
  });

  it("shares one bucket across an IPv6 /64 and separates different prefixes", () => {
    const { limiter } = limiterAt(1, 60_000);

    expect(limiter.admit("2001:db8:1:2:aaaa:bbbb:cccc:dddd").allowed).toBe(true);
    expect(limiter.admit("2001:db8:1:2:1111:2222:3333:4444").allowed).toBe(false);
    expect(limiter.admit("2001:0db8:0001:0002::1").allowed).toBe(false);
    expect(limiter.admit("2001:DB8:1:3::1").allowed).toBe(true);
    expect(limiter.admit("2001:db8:1:3::").allowed).toBe(false);
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address, and expands ::", () => {
    const { limiter } = limiterAt(1, 60_000);

    expect(limiter.admit("203.0.113.5").allowed).toBe(true);
    expect(limiter.admit("::ffff:203.0.113.5").allowed).toBe(false);
    expect(limiter.admit("::1").allowed).toBe(true);
    expect(limiter.admit("0:0:0:0:0:0:0:1").allowed).toBe(false);
    expect(limiter.admit("fe80::1%eth0").allowed).toBe(true);
    expect(limiter.admit("fe80::2").allowed).toBe(false);
  });
});
