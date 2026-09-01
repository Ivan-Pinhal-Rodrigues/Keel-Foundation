/**
 * Fixed-window request counter, in process memory.
 *
 * Three limits, all accepted for v1 (`specs/00-foundation.md` §3.3: "in-memory
 * token bucket per IP"). It exists to blunt credential stuffing against one
 * box, not to be a distributed quota; moving to Redis is a swap of this file
 * alone.
 *
 * 1. **Per instance only.** State lives in a module-level `Map`, so N app
 *    instances allow N × `max` requests and a restart clears every bucket.
 * 2. **Fixed window, not a sliding one or a true token bucket.** The counter
 *    resets on a wall-clock boundary rather than refilling continuously, so a
 *    caller can spend `max` at the end of one window and `max` again at the
 *    start of the next — a burst of ~2 × `max` across the seam. It still bounds
 *    the sustained rate, which is the point.
 * 3. **It trusts whatever key the caller derives.** The login route keys on the
 *    first `x-forwarded-for` hop, which any client can forge unless an ingress
 *    overwrites the header. The limit is therefore only meaningful behind a
 *    proxy that sets `x-forwarded-for` itself rather than appending to a
 *    client-supplied one.
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
