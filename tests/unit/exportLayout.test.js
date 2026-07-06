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
