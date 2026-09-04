// ── Unit tests: public/js/distribution.js ────────────────────────────────────
// Pure HTML builders extracted from renderDistributionPreview() — the sprint
// distribution modal's per-sprint capacity/checklist body and the
// warnings/suggestions message list (#460). distribution.js only imports
// state.js (no heavy DOM-entangled neighbor), so no mocking is needed.
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { buildDistributionBodyHtml, buildDistributionMessagesHtml } =
  await import('../../public/js/distribution.js');

function item(overrides = {}) {
  return {
    filename: 'a-story.md',
    docType: 'story',
    title: 'Do the thing',
    priority: 'Medium',
    storyPoints: 3,
    wasAlreadyAssigned: false,
    ...overrides,
  };
}

function sprint(overrides = {}) {
  return {
    name: 'Sprint 1',
    capacity: 20,
    usedPoints: 10,
    assigned: [],
    ...overrides,
  };
}

function data(overrides = {}) {
  return {
    sprints: [],
    overflow: [],
    warnings: [],
    suggestions: [],
    ...overrides,
  };
}

// ── buildDistributionBodyHtml ────────────────────────────────────────────────
describe('buildDistributionBodyHtml()', () => {
  test('renders a sprint header with name and capacity stats', () => {
    const html = buildDistributionBodyHtml(data({ sprints: [sprint()] }));
    assert.match(html, /distribution-sprint-name">Sprint 1</);
    assert.match(html, /distribution-sprint-stats">10 \/ 20 SP \(50%\)</);
  });

  test('capacity bar class is empty under 90%, "warn" over 90%, "over" over 100%', () => {
    const under = buildDistributionBodyHtml(data({ sprints: [sprint({ usedPoints: 10 })] }));
    assert.match(under, /distribution-capacity-bar ">/);

    const warn = buildDistributionBodyHtml(data({ sprints: [sprint({ usedPoints: 19 })] }));
    assert.match(warn, /distribution-capacity-bar warn">/);

    const over = buildDistributionBodyHtml(data({ sprints: [sprint({ usedPoints: 25 })] }));
    assert.match(over, /distribution-capacity-bar over">/);
  });

  test('capacity bar width is clamped to 100% even when over capacity', () => {
    const html = buildDistributionBodyHtml(data({ sprints: [sprint({ usedPoints: 40 })] }));
    assert.match(html, /distribution-capacity-fill" style="width:100%"/);
  });

  test('an effective capacity below full capacity shows the buffer percentage', () => {
    const html = buildDistributionBodyHtml(
      data({ sprints: [sprint({ capacity: 20, effectiveCapacity: 16, usedPoints: 8 })] })
    );
    assert.match(html, /8 \/ 16 SP \(50%, 20% buffer\)/);
  });

  test('zero capacity produces 0% rather than dividing by zero', () => {
    const html = buildDistributionBodyHtml(
      data({ sprints: [sprint({ capacity: 0, usedPoints: 0 })] })
    );
    assert.match(html, /0 \/ 0 SP \(0%\)/);
  });

  test('an empty sprint (no assigned items) shows the empty placeholder', () => {
    const html = buildDistributionBodyHtml(data({ sprints: [sprint({ assigned: [] })] }));
    assert.match(html, /distribution-sprint-empty">No items assigned</);
  });

  test('a not-yet-assigned item renders as a checked, indexed checkbox label', () => {
    const html = buildDistributionBodyHtml(data({ sprints: [sprint({ assigned: [item()] })] }));
    assert.match(html, /<label class="distribution-item">/);
    assert.match(html, /<input type="checkbox" checked data-sprint="0" data-item="0" \/>/);
    assert.doesNotMatch(html, /already-assigned/);
  });

  test('an already-assigned item renders as a locked, non-interactive row with an "Existing" badge', () => {
    const html = buildDistributionBodyHtml(
      data({ sprints: [sprint({ assigned: [item({ wasAlreadyAssigned: true })] })] })
    );
    assert.match(html, /<div class="distribution-item already-assigned">/);
    assert.match(html, /already-assigned-icon" title="Already in this sprint">🔒</);
    assert.match(html, /dist-badge existing">Existing</);
    assert.doesNotMatch(html, /<input type="checkbox"/);
  });

  test('a missing priority falls back to "Medium" for the badge class', () => {
    const html = buildDistributionBodyHtml(
      data({ sprints: [sprint({ assigned: [item({ priority: '' })] })] })
    );
    assert.match(html, /dist-badge priority-medium">/);
  });

  test('storyPoints present shows an SP badge; falsy storyPoints shows "No SP"', () => {
    const withPoints = buildDistributionBodyHtml(
      data({ sprints: [sprint({ assigned: [item({ storyPoints: 5 })] })] })
    );
    assert.match(withPoints, /dist-badge sp">5 SP</);

    const withoutPoints = buildDistributionBodyHtml(
      data({ sprints: [sprint({ assigned: [item({ storyPoints: null })] })] })
    );
    assert.match(withoutPoints, /dist-badge no-sp">No SP</);
  });

  test('an unrecognized docType falls back to the raw type as its own label', () => {
    const html = buildDistributionBodyHtml(
      data({ sprints: [sprint({ assigned: [item({ docType: 'widget' })] })] })
    );
    assert.match(html, /dist-badge type-widget">widget</);
  });

  test('multiple sprints render in order, concatenated', () => {
    const html = buildDistributionBodyHtml(
      data({ sprints: [sprint({ name: 'Sprint 1' }), sprint({ name: 'Sprint 2' })] })
    );
    const s1 = html.indexOf('Sprint 1');
    const s2 = html.indexOf('Sprint 2');
    assert.ok(s1 >= 0 && s2 > s1);
  });

  test('no overflow section is rendered when overflow is empty', () => {
    const html = buildDistributionBodyHtml(data({ sprints: [sprint()], overflow: [] }));
    assert.doesNotMatch(html, /distribution-overflow-section/);
  });

  test('overflow items render in their own section with a count', () => {
    const html = buildDistributionBodyHtml(
      data({ sprints: [], overflow: [item(), item({ filename: 'b.md' })] })
    );
    assert.match(html, /distribution-overflow-section/);
    assert.match(html, /distribution-sprint-name">Overflow</);
    assert.match(html, /2 item\(s\) — no capacity/);
    assert.match(html, /overflow-item/);
  });

  test('HTML-escapes item titles and sprint names everywhere they are interpolated', () => {
    const html = buildDistributionBodyHtml(
      data({
        sprints: [
          sprint({
            name: '<b>Sprint</b>',
            assigned: [item({ title: '<script>alert(1)</script>' })],
          }),
        ],
        overflow: [item({ title: '<u>overflow</u>' })],
      })
    );
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<b>Sprint<\/b>/);
    assert.doesNotMatch(html, /<u>overflow<\/u>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;b&gt;Sprint&lt;\/b&gt;/);
    assert.match(html, /&lt;u&gt;overflow&lt;\/u&gt;/);
  });
});

// ── buildDistributionMessagesHtml ────────────────────────────────────────────
describe('buildDistributionMessagesHtml()', () => {
  test('returns an empty string when there are no warnings or suggestions', () => {
    assert.equal(buildDistributionMessagesHtml(data()), '');
  });

  test('renders each warning in its own div', () => {
    const html = buildDistributionMessagesHtml(
      data({ warnings: [{ message: 'Over capacity' }, { message: 'Late add' }] })
    );
    assert.match(html, /distribution-msg warning">Over capacity</);
    assert.match(html, /distribution-msg warning">Late add</);
  });

  test('renders each suggestion in its own div', () => {
    const html = buildDistributionMessagesHtml(data({ suggestions: ['Consider splitting'] }));
    assert.match(html, /distribution-msg suggestion">Consider splitting</);
  });

  test('warnings are rendered before suggestions when both are present', () => {
    const html = buildDistributionMessagesHtml(
      data({ warnings: [{ message: 'W1' }], suggestions: ['S1'] })
    );
    assert.ok(html.indexOf('W1') < html.indexOf('S1'));
  });

  test('HTML-escapes warning and suggestion text', () => {
    const html = buildDistributionMessagesHtml(
      data({ warnings: [{ message: '<b>warn</b>' }], suggestions: ['<i>sugg</i>'] })
    );
    assert.doesNotMatch(html, /<b>warn<\/b>/);
    assert.doesNotMatch(html, /<i>sugg<\/i>/);
    assert.match(html, /&lt;b&gt;warn&lt;\/b&gt;/);
    assert.match(html, /&lt;i&gt;sugg&lt;\/i&gt;/);
  });
});
