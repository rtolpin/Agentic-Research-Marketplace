/**
 * Fixed-window per-key rate limiter. In-memory and per-process: good enough for a
 * single Railway instance; use a shared store (e.g. Redis) if you scale out.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(readonly limit: number, readonly windowMs: number) {}

  /** Records a hit and returns whether it is allowed, plus seconds until the window resets. */
  hit(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    let entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      entry = { windowStart: now, count: 0 };
      this.hits.set(key, entry);
    }
    const retryAfterSec = Math.ceil((entry.windowStart + this.windowMs - now) / 1000);
    if (entry.count >= this.limit) return { allowed: false, retryAfterSec };
    entry.count++;
    if (this.hits.size > 10_000) this.prune(now);
    return { allowed: true, retryAfterSec };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }
}

/** Caps how many runs execute at once across the process. */
export class ConcurrencyGate {
  private active = 0;

  constructor(readonly max: number) {}

  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }

  get inFlight(): number {
    return this.active;
  }
}
