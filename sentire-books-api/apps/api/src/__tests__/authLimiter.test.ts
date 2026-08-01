/**
 * Unit tests for the in-memory sign-in failure limiter and the lockout
 * backoff curve (M0.4). Time is injected, so nothing here sleeps.
 */
import { describe, it, expect } from "vitest";
import { FailureLimiter } from "../authLimiter";
import { authThrottleConfig, lockoutDurationMs } from "../config";

const WINDOW = 60_000;

/** Limiter with a controllable clock. */
function make(max: number) {
  let now = 1_000_000;
  const limiter = new FailureLimiter(WINDOW, max, () => now);
  return { limiter, advance: (ms: number) => (now += ms), at: () => now };
}

describe("FailureLimiter", () => {
  it("allows a fresh key", () => {
    const { limiter } = make(3);
    expect(limiter.check("ip").limited).toBe(false);
  });

  it("does not throttle below the threshold", () => {
    const { limiter } = make(3);
    limiter.fail("ip");
    limiter.fail("ip");
    expect(limiter.check("ip").limited).toBe(false);
  });

  it("throttles once the threshold is reached", () => {
    const { limiter } = make(3);
    limiter.fail("ip");
    limiter.fail("ip");
    const state = limiter.fail("ip");
    expect(state.limited).toBe(true);
    expect(state.retryAfterSec).toBeGreaterThan(0);
  });

  it("keeps separate budgets per key", () => {
    const { limiter } = make(2);
    limiter.fail("a");
    limiter.fail("a");
    expect(limiter.check("a").limited).toBe(true);
    expect(limiter.check("b").limited).toBe(false);
  });

  it("releases after the window passes", () => {
    const { limiter, advance } = make(2);
    limiter.fail("ip");
    limiter.fail("ip");
    expect(limiter.check("ip").limited).toBe(true);
    advance(WINDOW + 1);
    expect(limiter.check("ip").limited).toBe(false);
  });

  it("ages out individual failures within the window", () => {
    const { limiter, advance } = make(3);
    limiter.fail("ip");
    advance(WINDOW - 10);
    limiter.fail("ip");
    advance(20); // the first failure is now outside the window
    limiter.fail("ip");
    expect(limiter.check("ip").limited).toBe(false);
  });

  it("clear() forgets a key — a successful sign-in", () => {
    const { limiter } = make(2);
    limiter.fail("ip");
    limiter.fail("ip");
    expect(limiter.check("ip").limited).toBe(true);
    limiter.clear("ip");
    expect(limiter.check("ip").limited).toBe(false);
  });

  it("sweep() drops expired buckets so the map cannot grow forever", () => {
    const { limiter, advance } = make(5);
    limiter.fail("a");
    limiter.fail("b");
    expect(limiter.size).toBe(2);
    advance(WINDOW + 1);
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });

  it("reports a positive Retry-After while blocked", () => {
    const { limiter } = make(1);
    const state = limiter.fail("ip");
    expect(state.retryAfterSec).toBeGreaterThan(0);
    expect(state.retryAfterSec).toBeLessThanOrEqual(WINDOW / 1000);
  });
});

describe("lockoutDurationMs — escalating backoff", () => {
  const cfg = authThrottleConfig({
    AUTH_LOCKOUT_THRESHOLD: "5",
    AUTH_LOCKOUT_BASE_MS: "900000", // 15m
    AUTH_LOCKOUT_MAX_MS: "3600000", // 60m
  });

  it("does not lock below the threshold", () => {
    expect(lockoutDurationMs(1, cfg)).toBe(0);
    expect(lockoutDurationMs(4, cfg)).toBe(0);
  });

  it("locks for the base duration at the threshold", () => {
    expect(lockoutDurationMs(5, cfg)).toBe(900_000);
  });

  it("doubles on each further breach", () => {
    expect(lockoutDurationMs(10, cfg)).toBe(1_800_000);
    expect(lockoutDurationMs(15, cfg)).toBe(3_600_000);
  });

  it("caps at the configured maximum", () => {
    expect(lockoutDurationMs(50, cfg)).toBe(3_600_000);
    expect(lockoutDurationMs(500, cfg)).toBe(3_600_000);
  });
});

describe("authThrottleConfig", () => {
  it("has safe defaults with no env", () => {
    const cfg = authThrottleConfig({});
    expect(cfg.ipMaxFailures).toBeGreaterThan(0);
    expect(cfg.emailMaxFailures).toBeGreaterThan(0);
    // Email throttle must not be looser than the lockout, or a non-existent
    // email would stay answerable after a real one locks — an existence oracle.
    expect(cfg.emailMaxFailures).toBeLessThanOrEqual(cfg.lockoutThreshold);
  });

  it("accepts env overrides", () => {
    const cfg = authThrottleConfig({ AUTH_THROTTLE_IP_MAX: "3", AUTH_LOCKOUT_THRESHOLD: "2" });
    expect(cfg.ipMaxFailures).toBe(3);
    expect(cfg.lockoutThreshold).toBe(2);
  });

  it("ignores garbage and non-positive values", () => {
    const cfg = authThrottleConfig({ AUTH_THROTTLE_IP_MAX: "nonsense", AUTH_LOCKOUT_BASE_MS: "-5" });
    expect(cfg.ipMaxFailures).toBe(20);
    expect(cfg.lockoutBaseMs).toBe(15 * 60_000);
  });
});
