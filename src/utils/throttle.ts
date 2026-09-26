/**
 * Discord's global bot rate limit is ~50 requests/second, but the route
 * that matters most here is channel create/edit, which is far stricter in
 * practice (name/topic edits are limited to roughly 2 per 10 minutes PER
 * CHANNEL, and structural changes across many channels during a blueprint/
 * backup restore can easily trip per-route buckets). Rather than fire every
 * change at once and let discord.js's internal rate-limit handler queue and
 * silently stall, we throttle bulk operations ourselves so admins get
 * visible, predictable progress and so a big restore doesn't look "stuck".
 *
 * This is intentionally conservative (not maximally fast) - safety and
 * predictability matter more than speed for structural operations that
 * touch an entire server at once.
 */
export async function runThrottled<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  opts: { delayMs?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ errors: Array<{ item: T; error: unknown }> }> {
  const delayMs = opts.delayMs ?? 750;
  const errors: Array<{ item: T; error: unknown }> = [];

  for (let i = 0; i < items.length; i++) {
    try {
      await fn(items[i], i);
    } catch (error) {
      errors.push({ item: items[i], error });
    }
    opts.onProgress?.(i + 1, items.length);
    if (i < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { errors };
}
