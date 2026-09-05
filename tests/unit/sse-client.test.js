// ── Unit tests: public/js/sse-client.js's _handleSSEMessage ────────────────
// _handleSSEMessage is the SSE event router backing every real-time update
// in the app (docs, PI/sprint settings, roadmap, skills) — previously
// module-private and fully untested despite being the single dispatch point
// for every push event the server sends. Exported it (the `export` keyword
// is the entire production diff), same precedent as bugs-dashboard.ts's
// _statusClass (#535) and piconfig.ts's _sprintsFor extraction.
//
// sse-client.js statically imports store.js, list.js, piconfig.js,
// roadmap.js, and skills.js. The latter three transitively pull in the
// DOM-entangled view graph (roadmap.js -> roadmap-render.js/refine.js ->
// detail.js/main.js, same chain documented in mockRoadmapDeps.js and
// roadmap.test.js), so all four plus state.js's debounce are mocked out
// below with only the named exports sse-client.js actually calls.
// debounce is replaced with a synchronous passthrough so the debounced
// reload fires immediately instead of after a real 100ms timer.
//
// Every assertion below compares against `calls.slice()` rather than `calls`
// itself: assert.deepEqual's AssertionError keeps a *live reference* to the
// array it was given, not a snapshot, and this file reuses one shared,
// repeatedly-mutated `calls` array across every test — so a failing
// assertion's reported `actual` would otherwise reflect whatever the array
// looks like whenever the error is eventually printed (e.g. after later
// tests have already run), not its content at throw time.
import { mock, test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: () => null, addEventListener: () => {} };
}
// Normally set by state.js's own module-load side effect (`globalThis.splitThreshold = 8`),
// which doesn't run here since state.js is mocked below.
globalThis.splitThreshold = 8;

const calls = [];

mock.module('../../public/js/state.js', {
  namedExports: {
    debounce:
      (fn) =>
      (...args) =>
        fn(...args),
  },
});
mock.module('../../public/js/store.js', {
  namedExports: {
    upsertDoc: (doc) => calls.push(['upsertDoc', doc]),
    removeDoc: (filename) => calls.push(['removeDoc', filename]),
    setPiSettings: (settings) => calls.push(['setPiSettings', settings]),
  },
});
mock.module('../../public/js/list.js', {
  namedExports: {
    loadDocs: async () => calls.push(['loadDocs']),
  },
});
mock.module('../../public/js/piconfig.js', {
  namedExports: {
    loadAllSprintConfigs: async () => {
      calls.push(['loadAllSprintConfigs']);
    },
  },
});
mock.module('../../public/js/roadmap.js', {
  namedExports: {
    refreshRoadmapView: () => calls.push(['refreshRoadmapView']),
  },
});
mock.module('../../public/js/skills.js', {
  namedExports: {
    handleSkillSSE: (payload) => calls.push(['handleSkillSSE', payload]),
  },
});

const { _handleSSEMessage } = await import('../../public/js/sse-client.js');

// concurrency: false — subtests share the module-level `calls` array and the
// mocked modules' state (e.g. globalThis.splitThreshold), so they must run
// one at a time rather than Node's default concurrent subtest scheduling.
describe('_handleSSEMessage()', { concurrency: false }, () => {
  beforeEach(() => {
    calls.length = 0;
    globalThis.splitThreshold = 8;
  });

  test('a payload carrying a full doc upserts it and does nothing else', () => {
    const doc = { filename: 'a.md', docType: 'story' };
    _handleSSEMessage({ type: 'title_updated', doc });
    assert.deepEqual(calls.slice(), [['upsertDoc', doc]]);
  });

  test('doc_deleted with a filename removes it and does not also reload', () => {
    _handleSSEMessage({ type: 'doc_deleted', filename: 'a.md' });
    assert.deepEqual(calls.slice(), [['removeDoc', 'a.md']]);
  });

  test('doc_deleted without a filename falls through to a debounced reload', () => {
    _handleSSEMessage({ type: 'doc_deleted' });
    assert.deepEqual(calls.slice(), [['loadDocs']]);
  });

  for (const type of [
    'feature_created',
    'epic_created',
    'story_created',
    'spike_created',
    'bug_created',
    'status_updated',
    'title_updated',
    'batch_deleted',
    'batch_fix_version_updated',
    'batch_field_updated',
    'link_updated',
  ]) {
    test(`${type} (no doc payload) triggers a debounced reload`, () => {
      _handleSSEMessage({ type });
      assert.deepEqual(calls.slice(), [['loadDocs']]);
    });
  }

  test('an unrecognized event type triggers no calls at all', () => {
    _handleSSEMessage({ type: 'something_else' });
    assert.deepEqual(calls.slice(), []);
  });

  test('pi_settings_updated updates piSettings, then reloads docs and the roadmap', async () => {
    _handleSSEMessage({ type: 'pi_settings_updated', currentPi: 'PI-1', nextPi: 'PI-2' });
    // loadAllSprintConfigs() is called (and our mock's push runs) synchronously
    // here — only its .then() continuation below is deferred.
    assert.deepEqual(calls.slice(), [
      ['setPiSettings', { currentPi: 'PI-1', nextPi: 'PI-2' }],
      ['loadAllSprintConfigs'],
    ]);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(calls.slice(), [
      ['setPiSettings', { currentPi: 'PI-1', nextPi: 'PI-2' }],
      ['loadAllSprintConfigs'],
      ['loadDocs'],
      ['refreshRoadmapView'],
    ]);
  });

  test('pi_settings_updated defaults missing currentPi/nextPi to null', async () => {
    _handleSSEMessage({ type: 'pi_settings_updated' });
    assert.deepEqual(calls.slice(), [
      ['setPiSettings', { currentPi: null, nextPi: null }],
      ['loadAllSprintConfigs'],
    ]);
    // Let this call's own loadAllSprintConfigs().then(...) continuation settle
    // before the next test's beforeEach resets `calls` out from under it.
    await Promise.resolve();
    await Promise.resolve();
  });

  test('sprint_settings_updated reloads sprint configs, docs, and the roadmap', async () => {
    _handleSSEMessage({ type: 'sprint_settings_updated' });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(calls.slice(), [
      ['loadAllSprintConfigs'],
      ['loadDocs'],
      ['refreshRoadmapView'],
    ]);
  });

  test('batch_sprint_updated reloads docs and the roadmap synchronously', () => {
    _handleSSEMessage({ type: 'batch_sprint_updated' });
    assert.deepEqual(calls.slice(), [['loadDocs'], ['refreshRoadmapView']]);
  });

  test('split_threshold_updated refreshes the roadmap and updates the global threshold', () => {
    _handleSSEMessage({ type: 'split_threshold_updated', splitThreshold: 13 });
    assert.equal(globalThis.splitThreshold, 13);
    assert.deepEqual(calls.slice(), [['refreshRoadmapView']]);
  });

  test('split_threshold_updated keeps the existing threshold when none is sent', () => {
    globalThis.splitThreshold = 8;
    _handleSSEMessage({ type: 'split_threshold_updated' });
    assert.equal(globalThis.splitThreshold, 8);
  });

  test('split_threshold_updated syncs a visible input field when present', () => {
    let written = null;
    globalThis.document = {
      getElementById: (id) =>
        id === 'split-threshold-input'
          ? {
              set value(v) {
                written = v;
              },
            }
          : null,
      addEventListener: () => {},
    };
    _handleSSEMessage({ type: 'split_threshold_updated', splitThreshold: 21 });
    assert.equal(written, '21');
    globalThis.document = { getElementById: () => null, addEventListener: () => {} };
  });

  for (const type of [
    'skill_updated',
    'skill_reset',
    'product_context_updated',
    'product_context_reset',
  ]) {
    test(`${type} is routed to handleSkillSSE with the full payload`, () => {
      const payload = { type };
      _handleSSEMessage(payload);
      assert.deepEqual(calls.slice(), [['handleSkillSSE', payload]]);
    });
  }
});
