// ── Unit tests: src/utils/pMap.js ─────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pMap } from '../../src/utils/pMap.js';

describe('pMap', () => {
  test('processes all items and returns results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await pMap(items, async x => x * 2);
    assert.deepEqual(results, [2, 4, 6, 8, 10]);
  });

  test('works with an empty array', async () => {
    const results = await pMap([], async x => x);
    assert.deepEqual(results, []);
  });

  test('respects concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;

    const items = Array.from({ length: 10 }, (_, i) => i);
    await pMap(items, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setImmediate(r));
      active--;
    }, { concurrency: 3 });

    assert.ok(maxActive <= 3, `Expected max concurrency 3, got ${maxActive}`);
  });

  test('propagates errors from worker functions', async () => {
    await assert.rejects(
      () => pMap([1, 2, 3], async x => { if (x === 2) throw new Error('boom'); return x; }),
      /boom/,
    );
  });

  test('passes the item index as second argument', async () => {
    const indices = [];
    await pMap(['a', 'b', 'c'], async (_, i) => { indices.push(i); });
    assert.deepEqual(indices.sort((a, b) => a - b), [0, 1, 2]);
  });

  test('concurrency defaults to 5 when not specified', async () => {
    let active = 0;
    let maxActive = 0;

    const items = Array.from({ length: 20 }, (_, i) => i);
    await pMap(items, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setImmediate(r));
      active--;
    });

    assert.ok(maxActive <= 5, `Expected default max concurrency 5, got ${maxActive}`);
  });
});
