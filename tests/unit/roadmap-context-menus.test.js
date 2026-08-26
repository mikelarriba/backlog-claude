// ── Unit tests: public/js/roadmap-context-menus.js ─────────────────────────
// buildSprintSubmenuHtml() is the pure string builder split out of the
// module-private _buildSprintSubmenu wrapper (#460) so it's testable without
// the `piSettings`/`sprintConfig` ambient globals — callers pass both
// explicitly, same signature-change extraction as roadmap-render.ts's
// buildRoadmapCardHtml(doc, parent) (#508) and documentation.ts's
// buildSuggestionRowHtml(s, index, selected, expanded) (#552).
//
// roadmap-context-menus.js statically imports roadmap-render.js, detail.js,
// and roadmap.js, each of which transitively pulls in main.js (and, via
// detail.js, bugcreate.js's top-level DOMContentLoaded listener), which
// throws in a no-DOM test environment — same root cause documented in
// mockRoadmapDeps.js and roadmap-jira-sync.test.js. The function under test
// never calls into any of those three, so it's safe to replace them with
// no-op stubs purely so the module graph can load without a real DOM.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/roadmap-render.js', {
  namedExports: { renderRoadmapBoard: () => {} },
});
mock.module('../../public/js/detail.js', {
  namedExports: { openDoc: () => {} },
});
mock.module('../../public/js/roadmap.js', {
  namedExports: { refreshRoadmapView: () => {} },
});

const { buildSprintSubmenuHtml, RM_CTX_ACTIONS } =
  await import('../../public/js/roadmap-context-menus.js');

function sprint(name, overrides = {}) {
  return { name, capacity: 10, ...overrides };
}

describe('buildSprintSubmenuHtml()', () => {
  test('returns an empty string when there are no sprints in the current or next PI', () => {
    const html = buildSprintSubmenuHtml('a.md', 'story', { currentPi: 'PI-1', nextPi: 'PI-2' }, {});
    assert.equal(html, '');
  });

  test('returns an empty string when currentPi/nextPi are both unset', () => {
    const html = buildSprintSubmenuHtml(
      'a.md',
      'story',
      { currentPi: null, nextPi: null },
      { 'PI-1': [sprint('Sprint 1')] }
    );
    assert.equal(html, '');
  });

  test('renders one button per sprint in the current PI, plus the submenu wrapper', () => {
    const html = buildSprintSubmenuHtml(
      'a.md',
      'story',
      { currentPi: 'PI-1', nextPi: null },
      { 'PI-1': [sprint('Sprint 1'), sprint('Sprint 2')] }
    );
    assert.match(html, /ctx-submenu-wrap/);
    assert.match(html, /Add to Sprint ▸/);
    assert.match(
      html,
      new RegExp(
        `data-action="${RM_CTX_ACTIONS.setSprint}" data-filename="a\\.md" data-doc-type="story" data-sprint="Sprint 1"`
      )
    );
    assert.match(html, /data-sprint="Sprint 2"/);
  });

  test('includes sprints from both the current and next PI, in that order', () => {
    const html = buildSprintSubmenuHtml(
      'a.md',
      'story',
      { currentPi: 'PI-1', nextPi: 'PI-2' },
      { 'PI-1': [sprint('Sprint 1')], 'PI-2': [sprint('Sprint 3')] }
    );
    const i1 = html.indexOf('data-sprint="Sprint 1"');
    const i3 = html.indexOf('data-sprint="Sprint 3"');
    assert.ok(i1 >= 0 && i3 >= 0 && i1 < i3);
  });

  test('de-duplicates a sprint name shared by the current and next PI', () => {
    const html = buildSprintSubmenuHtml(
      'a.md',
      'story',
      { currentPi: 'PI-1', nextPi: 'PI-2' },
      { 'PI-1': [sprint('Shared')], 'PI-2': [sprint('Shared')] }
    );
    const matches = html.match(/data-sprint="Shared"/g) || [];
    assert.equal(matches.length, 1);
  });

  test('treats a PI with no sprint-config entry as empty rather than throwing', () => {
    const html = buildSprintSubmenuHtml(
      'a.md',
      'story',
      { currentPi: 'PI-1', nextPi: 'PI-2' },
      { 'PI-2': [sprint('Sprint 3')] }
    );
    assert.doesNotMatch(html, /Sprint 1/);
    assert.match(html, /data-sprint="Sprint 3"/);
  });

  test('appends a separator and a "Remove from sprint" danger button after the sprint list', () => {
    const html = buildSprintSubmenuHtml(
      'a.md',
      'story',
      { currentPi: 'PI-1', nextPi: null },
      { 'PI-1': [sprint('Sprint 1')] }
    );
    assert.match(html, /ctx-separator/);
    assert.match(
      html,
      new RegExp(
        `ctx-item ctx-danger" data-action="${RM_CTX_ACTIONS.setSprint}" data-filename="a\\.md" data-doc-type="story" data-sprint=""`
      )
    );
    assert.match(html, /Remove from sprint/);
  });

  test('omits the separator and "Remove from sprint" button when there are no sprints', () => {
    const html = buildSprintSubmenuHtml('a.md', 'story', { currentPi: null, nextPi: null }, {});
    assert.doesNotMatch(html, /ctx-separator/);
    assert.doesNotMatch(html, /Remove from sprint/);
  });

  test('escapes HTML-significant characters in the filename, docType, and sprint name', () => {
    const html = buildSprintSubmenuHtml(
      '<a>.md',
      '"story"',
      { currentPi: 'PI-1', nextPi: null },
      { 'PI-1': [sprint('<b>Sprint</b> & "Co"')] }
    );
    assert.doesNotMatch(html, /<a>|<b>/);
    assert.match(html, /data-filename="&lt;a&gt;\.md"/);
    assert.match(html, /data-doc-type="&quot;story&quot;"/);
    assert.match(html, /&lt;b&gt;Sprint&lt;\/b&gt; &amp; &quot;Co&quot;/);
  });
});
