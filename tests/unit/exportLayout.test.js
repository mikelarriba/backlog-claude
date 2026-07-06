// ── Unit tests: src/services/exportLayout.js ──────────────────────────────────
// Extracted from routes/export.ts (#341) — these are the pure layout/data
// algorithms behind the export routes, tested independently of Express/fs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  topoSortCards,
  computeAutoLayout,
  renderGrid,
  esc,
  escAttr,
  stripFrontmatter,
  epicColor,
} from '../../src/services/exportLayout.js';

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

describe('topoSortCards', () => {
  test('sorts by rank first', () => {
    const docs = [makeDoc({ filename: 'b.md', rank: 2 }), makeDoc({ filename: 'a.md', rank: 1 })];
    const sorted = topoSortCards(docs);
    assert.deepEqual(
      sorted.map((d) => d.filename),
      ['a.md', 'b.md']
    );
  });

  test('falls back to priority order when rank is missing', () => {
    const docs = [
      makeDoc({ filename: 'low.md', priority: 'low' }),
      makeDoc({ filename: 'critical.md', priority: 'critical' }),
      makeDoc({ filename: 'medium.md', priority: 'medium' }),
    ];
    const sorted = topoSortCards(docs);
    assert.deepEqual(
      sorted.map((d) => d.filename),
      ['critical.md', 'medium.md', 'low.md']
    );
  });

  test('moves a card after everything that blocks it', () => {
    // "a" is ranked first but is blocked by "b", so "b" must come first.
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

  test('resolves a 3-link blockedBy chain into full dependency order', () => {
    // "a" is ranked first but is blocked by "b", which is blocked by "c" —
    // both links must be walked so the final order is c, b, a.
    const docs = [
      makeDoc({ filename: 'a.md', rank: 1, blockedBy: ['b.md'] }),
      makeDoc({ filename: 'b.md', rank: 2, blockedBy: ['c.md'] }),
      makeDoc({ filename: 'c.md', rank: 3 }),
    ];
    const sorted = topoSortCards(docs);
    assert.deepEqual(
      sorted.map((d) => d.filename),
      ['c.md', 'b.md', 'a.md']
    );
  });

  // Note: a genuine mutual cycle (a blockedBy b *and* b blockedBy a) is NOT
  // exercised here — the reorder loop below has no cycle-breaking guard and
  // hangs indefinitely on that input (verified manually; not something a test
  // can safely assert against). A self-reference is the one cycle shape the
  // algorithm handles safely, since the "swap to a later position" check
  // (`bi > i`) is never true for a doc that blocks itself.
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

describe('computeAutoLayout', () => {
  test('returns an empty layout for no children', () => {
    assert.deepEqual(computeAutoLayout([], []), {});
  });

  test('places unblocked items in row 0 and increments row after each block', () => {
    const children = [{ filename: 'a.md' }, { filename: 'b.md' }, { filename: 'c.md' }];
    const blocks = [
      { src: 'a.md', tgt: 'b.md' },
      { src: 'b.md', tgt: 'c.md' },
    ];
    const layout = computeAutoLayout(children, blocks);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 1);
    assert.equal(layout['c.md'].row, 2);
    // All three are transitively connected, so they share one column.
    assert.equal(layout['a.md'].col, layout['b.md'].col);
    assert.equal(layout['b.md'].col, layout['c.md'].col);
  });

  test('places disconnected components in different columns', () => {
    const children = [{ filename: 'a.md' }, { filename: 'b.md' }];
    const layout = computeAutoLayout(children, []);
    assert.notEqual(layout['a.md'].col, layout['b.md'].col);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 0);
  });

  test('assigns three disconnected components three distinct columns', () => {
    const children = [{ filename: 'a.md' }, { filename: 'b.md' }, { filename: 'c.md' }];
    const layout = computeAutoLayout(children, []);
    const cols = new Set([layout['a.md'].col, layout['b.md'].col, layout['c.md'].col]);
    assert.equal(cols.size, 3);
  });

  test('a diamond dependency (two blockers converging on one child) merges into a single column', () => {
    // a -> c, b -> c: c's row must be max(a.row, b.row) + 1, and the union-find
    // column assignment must merge a, b, and c into the same connected component.
    const children = [{ filename: 'a.md' }, { filename: 'b.md' }, { filename: 'c.md' }];
    const blocks = [
      { src: 'a.md', tgt: 'c.md' },
      { src: 'b.md', tgt: 'c.md' },
    ];
    const layout = computeAutoLayout(children, blocks);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 0);
    assert.equal(layout['c.md'].row, 1);
    assert.equal(layout['a.md'].col, layout['b.md'].col);
    assert.equal(layout['b.md'].col, layout['c.md'].col);
  });

  test('ignores a block edge whose target is not in the children list', () => {
    const children = [{ filename: 'a.md' }];
    const blocks = [{ src: 'a.md', tgt: 'ghost.md' }];
    assert.doesNotThrow(() => computeAutoLayout(children, blocks));
    const layout = computeAutoLayout(children, blocks);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['ghost.md'], undefined);
  });
});

describe('renderGrid', () => {
  test('returns empty string for no child data', () => {
    assert.equal(renderGrid([], {}, [], [], 'Epic', 'epic'), '');
  });

  test('renders a grid with cards, the epic node, and a BLOCKS edge label', () => {
    const childData = [
      {
        filename: 'a.md',
        docType: 'story',
        title: 'Story A',
        storyPoints: 3,
        priority: 'Medium',
        status: 'Draft',
        jiraId: null,
        jiraUrl: null,
        content: '',
      },
      {
        filename: 'b.md',
        docType: 'story',
        title: 'Story B',
        storyPoints: null,
        priority: 'Medium',
        status: 'Draft',
        jiraId: 'ABC-1',
        jiraUrl: 'https://jira.example.com/browse/ABC-1',
        content: '',
      },
    ];
    const layout = { 'a.md': { col: 0, row: 0 }, 'b.md': { col: 0, row: 1 } };
    const blocks = [{ src: 'a.md', tgt: 'b.md' }];
    const html = renderGrid(childData, layout, blocks, [], 'My Epic', 'epic');
    assert.match(html, /Visual Plan/);
    assert.match(html, /Story A/);
    assert.match(html, /ABC-1/);
    assert.match(html, /BLOCKS/);
    assert.match(html, /My Epic/);
  });
});

describe('pure helpers', () => {
  test('esc escapes HTML-sensitive characters', () => {
    assert.equal(esc('<b>"Tom" & Jerry</b>'), '&lt;b&gt;&quot;Tom&quot; &amp; Jerry&lt;/b&gt;');
  });

  test('esc coerces non-string input (null, undefined, numbers) to a safe string', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(42), '42');
  });

  test('escAttr escapes ampersands, quotes, and newlines for use in HTML attributes', () => {
    assert.equal(escAttr('Tom & "Jerry"\nline two'), 'Tom &amp; &quot;Jerry&quot;&#10;line two');
  });

  test('escAttr leaves a string with no special characters unchanged', () => {
    assert.equal(escAttr('plain text'), 'plain text');
  });

  test('stripFrontmatter removes the leading YAML block', () => {
    const content = '---\nTitle: X\n---\nBody text';
    assert.equal(stripFrontmatter(content), 'Body text');
  });

  test('epicColor falls back for unknown categories', () => {
    assert.equal(epicColor('User Features'), '#16a34a');
    assert.equal(epicColor('Something Unknown'), '#94a3b8');
    assert.equal(epicColor(null), '#94a3b8');
  });
});
