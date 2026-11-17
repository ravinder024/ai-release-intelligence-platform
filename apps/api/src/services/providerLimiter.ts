/**
 * Process-wide governor for outbound model calls.
 *
 * Free/entry-level provider tiers rate-limit aggressively, and every evaluation runs several
 * scenarios in parallel. Without a shared limit, two overlapping runs (or a run plus its LLM
 * judge) can easily push dozens of calls at the same provider, which then answers HTTP 429 —
 * the user sees "random limits" and runs crawl. Every model call therefore takes a slot from
 * one global pool, so the platform never exceeds a predictable request rate regardless of how
 * many runs are active.
 */
const MAX_CONCURRENCY = Math.max(1, Number(process.env.PROVIDER_MAX_CONCURRENCY ?? 4));

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

/** Run one provider call while holding a global slot. Always releases, even on failure. */
export async function withProviderSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

/** Observability hooks for logs/tests. */
export function providerLoad(): { active: number; waiting: number; limit: number } {
  return { active, waiting: waiters.length, limit: MAX_CONCURRENCY };
}
