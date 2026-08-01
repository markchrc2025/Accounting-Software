/**
 * In-memory failure counter for sign-in throttling (M0.4).
 *
 * Counts only FAILED attempts in a rolling window, keyed by IP and by email, so
 * a normal sign-in is never throttled. Covering emails that do not exist is the
 * point: it means a throttled response cannot be used to probe which accounts
 * are real.
 *
 * TODO(M7): this is per-process state. The moment the API runs more than one
 * instance, an attacker can multiply their budget by the instance count — move
 * these counters to a shared store (e.g. Redis) as part of the HA work.
 */

interface Bucket {
  /** Timestamps (ms) of failures still inside the window. */
  hits: number[];
  /** When the caller may try again; 0 when not throttled. */
  blockedUntil: number;
}

export class FailureLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxFailures: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Drop failures that have aged out of the window. */
  private prune(bucket: Bucket, at: number): void {
    const cutoff = at - this.windowMs;
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
  }

  /**
   * Is this key currently throttled? Returns the seconds to wait, for the
   * Retry-After header.
   */
  check(key: string): { limited: boolean; retryAfterSec: number } {
    const at = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket) return { limited: false, retryAfterSec: 0 };
    if (bucket.blockedUntil > at) {
      return { limited: true, retryAfterSec: Math.ceil((bucket.blockedUntil - at) / 1000) };
    }
    this.prune(bucket, at);
    if (bucket.hits.length >= this.maxFailures) {
      return { limited: true, retryAfterSec: Math.ceil(this.windowMs / 1000) };
    }
    return { limited: false, retryAfterSec: 0 };
  }

  /** Record one failed attempt. Returns the state AFTER recording. */
  fail(key: string): { limited: boolean; retryAfterSec: number } {
    const at = this.now();
    const bucket = this.buckets.get(key) ?? { hits: [], blockedUntil: 0 };
    this.prune(bucket, at);
    bucket.hits.push(at);
    if (bucket.hits.length >= this.maxFailures) {
      bucket.blockedUntil = at + this.windowMs;
    }
    this.buckets.set(key, bucket);
    return this.check(key);
  }

  /** Forget a key — called on a successful sign-in. */
  clear(key: string): void {
    this.buckets.delete(key);
  }

  /** Drop empty/expired buckets so the map can't grow without bound. */
  sweep(): void {
    const at = this.now();
    for (const [key, bucket] of this.buckets) {
      this.prune(bucket, at);
      if (bucket.hits.length === 0 && bucket.blockedUntil <= at) this.buckets.delete(key);
    }
  }

  /** Test seam. */
  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}
