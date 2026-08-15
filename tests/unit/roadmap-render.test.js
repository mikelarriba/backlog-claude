// ── Unit tests: public/js/roadmap-render.js ────────────────────────────────────
// Pure Gantt-view helpers (topological card ordering, epic category color, card
// height) exercised without a DOM/browser (#347). See mockRoadmapDeps.js for why
// roadmap.js/roadmap-drag.js/roadmap-select.js are stubbed before import.
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installRoadmapMocks } from '../helpers/mockRoadmapDeps.js';

installRoadmapMocks();
const { topoSortCards, epicColor, spCardHeight, buildRoadmapCardHtml } =
  await import('../../public/js/roadmap-render.js');

function makeDoc(overrides = {}) {
  return {
    filename: 'doc.md',
    docType: 'story',
    title: 'A Story',
    date: '2024-01-01',
    status: 'Draft',
    fixVersion: null,
    jiraId: null,
    jiraUrl: null,
    storyPoints: null,
    sprint: null,
    rank: null,
    priority: 'Medium',
    parentFilename: null,
    parentType: null,
    blocks: [],
    blockedBy: [],
    parallel: [],
    pi: null,
    team: null,
    workCategory: null,
    hasDescription: false,
    descriptionSnippet: null,
    ...overrides,
  };
}

// ── topoSortCards ─────────────────────────────────────────────────────────────
describe('topoSortCards', () => {
  test('returns empty input as-is', () => {
    assert.deepEqual(topoSortCards([]), []);
  });

  test('sorts by rank first, then by priority when rank is missing', () => {
    const docs = [
      makeDoc({ filename: 'low.md', priority: 'low' }),
      makeDoc({ filename: 'critical.md', priority: 'critical' }),
      makeDoc({ filename: 'ranked.md', rank: 0, priority: 'low' }),
    ];
    const sorted = topoSortCards(docs);
    // ranked.md has an explicit rank so it wins regardless of priority;
    // the unranked docs then fall back to priority order.
    assert.deepEqual(
      sorted.map((d) => d.filename),
      ['ranked.md', 'critical.md', 'low.md']
    );
  });

  test('moves a card after everything that blocks it, even when ranked earlier', () => {
    const docs = [
      makeDoc({ filename: 'a.md', rank: 1, blockedBy: ['b.md'] }),
      makeDoc({ filename: 'b.md', rank: 2 }),
    ];
    const sorted = topoSortCards(docs);
    assert.deepEqual(
      sorted.map((d) => d.filename),
      ['b.md', 'a.md']
    );
  });

  // Note: a genuine mutual cycle (a blockedBy b *and* b blockedBy a) is NOT
  // exercised here. The dependency-reorder pass below has no cycle-breaking
  // guard: swapping a's and b's positions on each pass flips back and forth
  // forever, so it hangs indefinitely on that input (verified manually — not
  // something a test can safely assert against). This mirrors the same
  // limitation documented for src/services/exportLayout.ts's topoSortCards in
  // tests/unit/exportLayout.test.js (a different, backend-side implementation).
  // A self-reference is the one cycle shape handled safely here, since the
  // "swap to a later position" check (`bi > i`) is never true for a doc
  // blocked by itself (its own index).
  test('a doc that blocks itself does not hang and is left in place', () => {
    const docs = [
      makeDoc({ filename: 'a.md', rank: 1, blockedBy: ['a.md'] }),
      makeDoc({ filename: 'b.md', rank: 2 }),
    ];
    const sorted = topoSortCards(docs);
    assert.deepEqual(
      sorted.map((d) => d.filename),
      ['a.md', 'b.md']
    );
  });
});

// ── epicColor ─────────────────────────────────────────────────────────────────
describe('epicColor', () => {
  test('returns the mapped color for a known work category', () => {
    assert.equal(epicColor('User Features'), '#16a34a');
    assert.equal(epicColor('Technical Debt'), '#dc2626');
  });

  test('falls back to the neutral color for an unrecognized category', () => {
    assert.equal(epicColor('Something Unknown'), '#94a3b8');
  });

  test('falls back to the neutral color for null/undefined', () => {
    assert.equal(epicColor(null), '#94a3b8');
    assert.equal(epicColor(undefined), '#94a3b8');
  });
});

// ── spCardHeight ──────────────────────────────────────────────────────────────
describe('spCardHeight', () => {
  test('returns the exact height for a known Fibonacci story-point value', () => {
    assert.equal(spCardHeight(3), 80);
    assert.equal(spCardHeight(13), 132);
  });

  test('rounds a non-Fibonacci value to its closest known bucket', () => {
    // 4 is equidistant-ish between 3 and 5; closest by absolute distance is 3.
    assert.equal(spCardHeight(4), spCardHeight(3));
  });

  test('treats missing/non-numeric story points as 0', () => {
    assert.equal(spCardHeight(undefined), spCardHeight(0));
    assert.equal(spCardHeight(null), spCardHeight(0));
  });
});

// ── buildRoadmapCardHtml ────────────────────────────────────────────────────
// Pure string builder split out of renderRoadmapCard so it's testable without
// the `allDocs` global — callers resolve the parent doc themselves (#460).
describe('buildRoadmapCardHtml', () => {
  test('renders title, type, priority, and story-point badges', () => {
    const html = buildRoadmapCardHtml(
      makeDoc({ filename: 'a.md', docType: 'story', title: 'Do the thing', priority: 'High' }),
      undefined
    );
    assert.match(html, /roadmap-card-title">Do the thing</);
    assert.match(html, /rm-type-story">Story</);
    assert.match(html, /rm-priority-high">High</);
  });

  test('shows "No SP" and the rm-no-estimate class when storyPoints is unset', () => {
    const html = buildRoadmapCardHtml(makeDoc({ storyPoints: null }), undefined);
    assert.match(html, /rm-no-sp">No SP</);
    assert.match(html, /roadmap-card rm-no-estimate"/);
  });

  test('shows the SP count and omits rm-no-estimate when storyPoints is set', () => {
    const html = buildRoadmapCardHtml(makeDoc({ storyPoints: 5 }), undefined);
    assert.match(html, /rm-sp">5 SP</);
    assert.doesNotMatch(html, /rm-no-estimate/);
  });

  test('wires up the core data-* attributes from the doc', () => {
    const html = buildRoadmapCardHtml(
      makeDoc({
        filename: 'a.md',
        docType: 'story',
        storyPoints: 3,
        parentFilename: 'epic.md',
        sprint: 'Sprint 1',
      }),
      undefined
    );
    assert.match(
      html,
      /data-filename="a\.md"\s+data-doctype="story"\s+data-sp="3"\s+data-parent="epic\.md"\s+data-sprint="Sprint 1"/
    );
  });

  test('omits the parent block when there is no parent doc', () => {
    const html = buildRoadmapCardHtml(makeDoc({ parentFilename: null }), undefined);
    assert.doesNotMatch(html, /roadmap-card-parent/);
  });

  test('renders the parent block using the pre-resolved parent, colored by its work category', () => {
    const html = buildRoadmapCardHtml(makeDoc({ parentFilename: 'epic.md' }), {
      title: 'Parent Epic',
      workCategory: 'User Features',
    });
    assert.match(
      html,
      /roadmap-card-parent"><span class="rm-parent-dot" style="background:#16a34a"><\/span>Parent Epic/
    );
  });

  test('renders dependency badges only for the relationship types present', () => {
    const html = buildRoadmapCardHtml(
      makeDoc({ blockedBy: ['x.md'], blocks: [], parallel: ['y.md', 'z.md'] }),
      undefined
    );
    assert.match(html, /dep-blocked">⬅ blocked by 1</);
    assert.doesNotMatch(html, /dep-blocks"/);
    assert.match(html, /dep-parallel"># parallel 2</);
    assert.match(html, /class="roadmap-card rm-dep-blocked/);
  });

  test('escapes HTML-significant characters in the title and parent title', () => {
    const html = buildRoadmapCardHtml(
      makeDoc({ parentFilename: 'epic.md', title: '<script>alert("x")</script>' }),
      { title: 'A & B', workCategory: null }
    );
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /roadmap-card-title">&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;</);
    assert.match(html, /A &amp; B/);
  });
});
