// ── Unit tests: public/js/store.js ───────────────────────────────────────────
// Tests the event-driven state store (no DOM dependencies).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getState,
  setDocs,
  upsertDoc,
  removeDoc,
  setPiSettings,
  on,
} from '../../public/js/store.js';

function resetState() {
  setDocs([]);
  setPiSettings({ currentPi: null, nextPi: null });
}

// ── getState ──────────────────────────────────────────────────────────────────
describe('store: getState', () => {
  beforeEach(resetState);

  test('returns a frozen object', () => {
    const state = getState();
    assert.throws(() => {
      state.docs = [];
    }, TypeError);
  });

  test('docs is a defensive copy — mutation does not affect the store', () => {
    const { docs } = getState();
    docs.push({ filename: 'injected.md' });
    assert.equal(getState().docs.length, 0);
  });

  test('initial docs is empty array', () => {
    assert.deepEqual(getState().docs, []);
  });

  test('initial piSettings has null PIs', () => {
    assert.deepEqual(getState().piSettings, { currentPi: null, nextPi: null });
  });
});

// ── setDocs ───────────────────────────────────────────────────────────────────
describe('store: setDocs', () => {
  beforeEach(resetState);

  test('replaces all docs', () => {
    setDocs([{ filename: 'a.md', title: 'A' }]);
    assert.equal(getState().docs.length, 1);
    assert.equal(getState().docs[0].filename, 'a.md');
  });

  test('setting empty array clears docs', () => {
    setDocs([{ filename: 'a.md' }]);
    setDocs([]);
    assert.equal(getState().docs.length, 0);
  });

  test('emits docs:changed with the new docs', () => {
    let received = null;
    const off = on('docs:changed', (payload) => {
      received = payload;
    });
    setDocs([{ filename: 'b.md' }]);
    off();
    assert.ok(received, 'event should have fired');
    assert.equal(received.docs.length, 1);
    assert.equal(received.docs[0].filename, 'b.md');
  });
});

// ── upsertDoc ─────────────────────────────────────────────────────────────────
describe('store: upsertDoc', () => {
  beforeEach(resetState);

  test('adds a new doc when filename not present', () => {
    upsertDoc({ filename: 'new.md', title: 'New' });
    assert.equal(getState().docs.length, 1);
    assert.equal(getState().docs[0].filename, 'new.md');
  });

  test('updates an existing doc matched by filename', () => {
    setDocs([{ filename: 'x.md', title: 'Old' }]);
    upsertDoc({ filename: 'x.md', title: 'Updated' });
    const { docs } = getState();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, 'Updated');
  });

  test('does not duplicate when upserting an existing filename', () => {
    setDocs([{ filename: 'x.md' }]);
    upsertDoc({ filename: 'x.md', title: 'v2' });
    assert.equal(getState().docs.length, 1);
  });

  test('emits doc:upserted event with the doc', () => {
    let received = null;
    const off = on('doc:upserted', (payload) => {
      received = payload;
    });
    upsertDoc({ filename: 'u.md', title: 'U' });
    off();
    assert.equal(received?.doc?.filename, 'u.md');
  });

  test('emits docs:changed after upsert', () => {
    let fired = false;
    const off = on('docs:changed', () => {
      fired = true;
    });
    upsertDoc({ filename: 'v.md' });
    off();
    assert.ok(fired);
  });
});

// ── removeDoc ─────────────────────────────────────────────────────────────────
describe('store: removeDoc', () => {
  beforeEach(resetState);

  test('removes doc by filename', () => {
    setDocs([{ filename: 'rem.md' }, { filename: 'keep.md' }]);
    removeDoc('rem.md');
    const { docs } = getState();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].filename, 'keep.md');
  });

  test('is a no-op when filename not found', () => {
    setDocs([{ filename: 'keep.md' }]);
    removeDoc('not-exist.md');
    assert.equal(getState().docs.length, 1);
  });

  test('emits doc:removed with the filename', () => {
    let received = null;
    const off = on('doc:removed', (payload) => {
      received = payload;
    });
    setDocs([{ filename: 'r.md' }]);
    removeDoc('r.md');
    off();
    assert.equal(received?.filename, 'r.md');
  });

  test('emits docs:changed after remove', () => {
    let fired = false;
    setDocs([{ filename: 'z.md' }]);
    const off = on('docs:changed', () => {
      fired = true;
    });
    removeDoc('z.md');
    off();
    assert.ok(fired);
  });
});

// ── setPiSettings ─────────────────────────────────────────────────────────────
describe('store: setPiSettings', () => {
  beforeEach(resetState);

  test('updates piSettings in state', () => {
    setPiSettings({ currentPi: 'PI-1', nextPi: 'PI-2' });
    const { piSettings } = getState();
    assert.equal(piSettings.currentPi, 'PI-1');
    assert.equal(piSettings.nextPi, 'PI-2');
  });

  test('emits piSettings:changed with new settings', () => {
    let received = null;
    const off = on('piSettings:changed', (payload) => {
      received = payload;
    });
    setPiSettings({ currentPi: 'PI-X', nextPi: null });
    off();
    assert.equal(received?.settings?.currentPi, 'PI-X');
    assert.equal(received?.settings?.nextPi, null);
  });
});

// ── on (subscriptions) ────────────────────────────────────────────────────────
describe('store: on', () => {
  beforeEach(resetState);

  test('returned unsubscribe stops future events', () => {
    let count = 0;
    const off = on('docs:changed', () => {
      count++;
    });
    setDocs([{ filename: 'a.md' }]);
    off();
    setDocs([{ filename: 'b.md' }]);
    assert.equal(count, 1);
  });

  test('multiple listeners on the same event all fire', () => {
    let a = 0;
    let b = 0;
    const offA = on('docs:changed', () => {
      a++;
    });
    const offB = on('docs:changed', () => {
      b++;
    });
    setDocs([]);
    offA();
    offB();
    assert.equal(a, 1);
    assert.equal(b, 1);
  });
});
