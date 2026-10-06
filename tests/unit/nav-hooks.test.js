// ── Unit tests: public/js/nav-hooks.js ──────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDoc,
  focusEpic,
  registerOpenDoc,
  registerFocusEpic,
} from '../../public/js/nav-hooks.js';

describe('nav-hooks', () => {
  test('forwarders are safe no-ops before anything registers', () => {
    assert.doesNotThrow(() => openDoc('a.md', 'epic'));
    assert.doesNotThrow(() => focusEpic('a.md'));
  });

  test('openDoc forwards to the registered implementation', () => {
    const seen = [];
    registerOpenDoc((f, t) => seen.push([f, t]));
    openDoc('a.md', 'story');
    assert.deepEqual(seen, [['a.md', 'story']]);
  });

  test('focusEpic forwards to the registered implementation', () => {
    const seen = [];
    registerFocusEpic((f) => seen.push(f));
    focusEpic('e.md');
    assert.deepEqual(seen, ['e.md']);
  });
});
