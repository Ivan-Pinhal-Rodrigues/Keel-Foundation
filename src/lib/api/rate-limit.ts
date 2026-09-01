/**
 * Fixed-window request counter, in process memory.
 *
 * **Per instance only.** State lives in a module-level `Map`, so N app
 * instances allow N × `max` requests and a restart clears every bucket. That is
 * accepted for v1 (`specs/00-foundation.md` §3.3: "in-memory token bucket per
 * IP") — it exists to blunt credential stuffing against one box, not to be a
 * distributed quota. Moving to Redis is a swap of this file alone.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Record one hit against `key` and report whether it is allowed.
 *
 * @returns `true` if the caller is under `max` hits in the current `windowMs`
 *   window, `false` once it is over — so callers read as
 *   `if (!rateLimit(...)) return 429`.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

/** Drop expired buckets so a long-running instance does not accumulate one
 *  entry per IP ever seen. Cheap: only runs when a new window opens. */
function sweep(now: number): void {
  if (buckets.size < 1024) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}
