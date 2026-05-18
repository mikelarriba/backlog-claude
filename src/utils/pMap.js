// ── Concurrency-limited async mapper ──────────────────────────────────────────
// Processes `items` through `fn` with at most `concurrency` parallel invocations.
// Drop-in replacement for Promise.all when uncontrolled fan-out would exhaust
// external rate limits (e.g. JIRA API's 429 threshold).
//
// Usage:
//   const results = await pMap(items, async item => fetchJira(item), { concurrency: 5 });

/**
 * @template T, U
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<U>} fn
 * @param {{ concurrency?: number }} [opts]
 * @returns {Promise<U[]>}
 */
export async function pMap(items, fn, { concurrency = 5 } = {}) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
