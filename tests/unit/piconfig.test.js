// ── Unit tests: public/js/piconfig.js ───────────────────────────────────────
// computeSprintsForPi() is the pure lookup split out of the module-private
// _sprintsFor wrapper (#460) so it's testable without the sprintConfig
// ambient global — callers pass the config map explicitly, same
// signature-change extraction as roadmap.ts's getAllSprints ->
// computeVisibleSprints (#577) and roadmap-context-menus.ts's
// _buildSprintSubmenu -> buildSprintSubmenuHtml (#567).
//
// piconfig.js statically imports roadmap.js and jira-import.js, both of
// which transitively pull in the rest of the app (roadmap.js ->
// roadmap-render.js -> ... -> main.js -> bugcreate.js's top-level
// DOMContentLoaded listener), which throws in a no-DOM test environment —
// same root cause documented in mockRoadmapDeps.js and
// roadmap-context-menus.test.js. computeSprintsForPi() never calls into
// either, so it's safe to replace them with no-op stubs purely so the
// module graph can load without a real DOM.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/roadmap.js', {
  namedExports: { refreshRoadmapView: () => {} },
});
mock.module('../../public/js/jira-import.js', {
  namedExports: { showJiraSelectModal: () => {}, performJiraPull: async () => {} },
});

const { computeSprintsForPi } = await import('../../public/js/piconfig.js');

describe('computeSprintsForPi()', () => {
  test('returns the sprint list for a configured PI', () => {
    const cfg = {
      'PI-2026-Q2': [
        { name: 'Sprint 1', capacity: 40 },
        { name: 'Sprint 2', capacity: 40 },
      ],
    };
    assert.deepEqual(computeSprintsForPi('PI-2026-Q2', cfg), [
      { name: 'Sprint 1', capacity: 40 },
      { name: 'Sprint 2', capacity: 40 },
    ]);
  });

  test('returns an empty array when the PI has no entry in the config', () => {
    assert.deepEqual(
      computeSprintsForPi('PI-2026-Q3', { 'PI-2026-Q2': [{ name: 'S1', capacity: 10 }] }),
      []
    );
  });

  test('returns an empty array for an empty config', () => {
    assert.deepEqual(computeSprintsForPi('PI-2026-Q2', {}), []);
  });

  test('does not mutate the config it is given', () => {
    const cfg = { 'PI-2026-Q2': [{ name: 'Sprint 1', capacity: 40 }] };
    const before = JSON.stringify(cfg);
    computeSprintsForPi('PI-2026-Q2', cfg);
    assert.equal(JSON.stringify(cfg), before);
  });

  test('returns the actual array reference stored for the PI, not a copy', () => {
    const sprints = [{ name: 'Sprint 1', capacity: 40 }];
    const cfg = { 'PI-2026-Q2': sprints };
    assert.equal(computeSprintsForPi('PI-2026-Q2', cfg), sprints);
  });
});
