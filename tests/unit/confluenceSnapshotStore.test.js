// ── Unit tests: src/services/confluenceSnapshotStore.ts ───────────────────────
// Covers the in-memory TTL snapshot store in isolation — no server, no
// Confluence. Full execute/undo request behavior is covered by
// tests/integration/confluence.test.js. TTL expiry is exercised here via the
// store's injected `now` override (createSnapshot/getSnapshot both accept an
// optional `now` param) rather than real timers or a fake-timer library —
// mirrors the injected-time style used elsewhere in this repo for testability
// (e.g. isoDate()-style callers in transforms.ts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSnapshot,
  getSnapshot,
  deleteSnapshot,
  SNAPSHOT_TTL_MS,
} from '../../src/services/confluenceSnapshotStore.ts';

function op(overrides = {}) {
  return {
    action: 'Update',
    pageTitle: 'Some Page',
    pageId: '123',
    previousContent: '<p>old</p>',
    previousVersion: 2,
    ...overrides,
  };
}

describe('createSnapshot / getSnapshot', () => {
  test('getSnapshot returns the stored operations for a fresh snapshot', () => {
    const operations = [op()];
    const id = createSnapshot(operations);
    const snapshot = getSnapshot(id);
    assert.ok(snapshot);
    assert.equal(snapshot.id, id);
    assert.deepEqual(snapshot.operations, operations);
  });

  test('generates a distinct UUID per call', () => {
    const id1 = createSnapshot([op()]);
    const id2 = createSnapshot([op()]);
    assert.notEqual(id1, id2);
  });

  test('getSnapshot returns null for an unknown id', () => {
    assert.equal(getSnapshot('00000000-0000-0000-0000-000000000000'), null);
  });
});

describe('TTL expiry', () => {
  test('getSnapshot returns the snapshot when read just under the TTL', () => {
    const start = 1_000_000;
    const id = createSnapshot([op()], start);
    const result = getSnapshot(id, start + SNAPSHOT_TTL_MS - 1);
    assert.ok(result);
  });

  test('getSnapshot returns null once the TTL has elapsed', () => {
    const start = 1_000_000;
    const id = createSnapshot([op()], start);
    const result = getSnapshot(id, start + SNAPSHOT_TTL_MS + 1);
    assert.equal(result, null);
  });

  test('an expired snapshot is evicted — a later read (even within a fresh TTL window) still returns null', () => {
    const start = 1_000_000;
    const id = createSnapshot([op()], start);
    assert.equal(getSnapshot(id, start + SNAPSHOT_TTL_MS + 1), null);
    // Even "now" reset back near start (simulating no real time passing),
    // eviction already happened — the id is simply gone.
    assert.equal(getSnapshot(id, start), null);
  });
});

describe('deleteSnapshot', () => {
  test('removes a snapshot so subsequent getSnapshot calls return null', () => {
    const id = createSnapshot([op()]);
    assert.ok(getSnapshot(id));
    deleteSnapshot(id);
    assert.equal(getSnapshot(id), null);
  });

  test('is a no-op for an unknown id', () => {
    assert.doesNotThrow(() => deleteSnapshot('not-a-real-id'));
  });
});
