// ── Unit tests: public/js/canvasLayout.js ─────────────────────────────────────
// Pure layout computation for the refine canvas — deterministic math with no
// DOM access, explicitly documented as safe to unit-test in isolation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAutoLayout,
  compactLayout,
  computeEdgeMovePosition,
  buildBlocksAndParallel,
  computeSecEdges,
  computeCanvasRanks,
} from '../../public/js/canvasLayout.js';

function makeChild(filename) {
  return { filename, docType: 'story', title: filename };
}

describe('computeAutoLayout()', () => {
  test('returns an empty layout when there are no children', () => {
    assert.deepEqual(computeAutoLayout([], [], []), {});
  });

  test('a single unblocked child is placed at row 0, column 0', () => {
    const children = [makeChild('a.md')];
    const layout = computeAutoLayout(children, [], []);
    assert.deepEqual(layout, { 'a.md': { col: 0, row: 0 } });
  });

  test('blocks edges push the blocked item to a later row in the same column', () => {
    const children = [makeChild('a.md'), makeChild('b.md')];
    const blocks = [{ src: 'a.md', tgt: 'b.md' }];
    const layout = computeAutoLayout(children, blocks, []);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 1);
    assert.equal(layout['a.md'].col, layout['b.md'].col);
  });

  test('a chain of blocks assigns strictly increasing rows in the same column', () => {
    const children = [makeChild('a.md'), makeChild('b.md'), makeChild('c.md')];
    const blocks = [
      { src: 'a.md', tgt: 'b.md' },
      { src: 'b.md', tgt: 'c.md' },
    ];
    const layout = computeAutoLayout(children, blocks, []);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 1);
    assert.equal(layout['c.md'].row, 2);
    assert.equal(layout['a.md'].col, layout['b.md'].col);
    assert.equal(layout['b.md'].col, layout['c.md'].col);
  });

  test('unconnected items each get their own column at row 0', () => {
    const children = [makeChild('a.md'), makeChild('b.md')];
    const layout = computeAutoLayout(children, [], []);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 0);
    assert.notEqual(layout['a.md'].col, layout['b.md'].col);
  });

  test('a node blocking two others fans out to a shared later row but does not force them into the same column', () => {
    const children = [makeChild('a.md'), makeChild('b.md'), makeChild('c.md')];
    const blocks = [
      { src: 'a.md', tgt: 'b.md' },
      { src: 'a.md', tgt: 'c.md' },
    ];
    const layout = computeAutoLayout(children, blocks, []);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 1);
    assert.equal(layout['c.md'].row, 1);
    // b and c both depend only on a (same column, a's workstream) via union-find
    assert.equal(layout['b.md'].col, layout['c.md'].col);
  });

  test('an orphaned node unreachable from any root still gets a row (no crash on cycles)', () => {
    // a and b block each other — no true root exists in this pair.
    const children = [makeChild('a.md'), makeChild('b.md')];
    const blocks = [
      { src: 'a.md', tgt: 'b.md' },
      { src: 'b.md', tgt: 'a.md' },
    ];
    const layout = computeAutoLayout(children, blocks, []);
    assert.equal(typeof layout['a.md'].row, 'number');
    assert.equal(typeof layout['b.md'].row, 'number');
  });

  test('parallel pairs are accepted but do not affect column assignment (not unioned)', () => {
    const children = [makeChild('a.md'), makeChild('b.md')];
    const parallel = [{ a: 'a.md', b: 'b.md' }];
    const layout = computeAutoLayout(children, [], parallel);
    assert.equal(layout['a.md'].row, 0);
    assert.equal(layout['b.md'].row, 0);
    assert.notEqual(layout['a.md'].col, layout['b.md'].col);
  });
});

describe('compactLayout()', () => {
  test('leaves an already-consecutive layout unchanged', () => {
    const positions = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 }, c: { col: 0, row: 1 } };
    const result = compactLayout(positions);
    assert.deepEqual(result.positions, positions);
    assert.equal(result.changed, false);
    assert.deepEqual(result.usedCols, [0, 1]);
    assert.deepEqual(result.usedRows, [0, 1]);
  });

  test('closes a column gap by renumbering to consecutive integers', () => {
    const positions = { a: { col: 0, row: 0 }, b: { col: 5, row: 0 } };
    const result = compactLayout(positions);
    assert.deepEqual(result.positions, { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } });
    assert.equal(result.changed, true);
  });

  test('closes a row gap by renumbering to consecutive integers', () => {
    const positions = { a: { col: 0, row: 0 }, b: { col: 0, row: 7 } };
    const result = compactLayout(positions);
    assert.deepEqual(result.positions, { a: { col: 0, row: 0 }, b: { col: 0, row: 1 } });
    assert.equal(result.changed, true);
  });

  test('preserves relative order of non-consecutive values', () => {
    const positions = { a: { col: 2, row: 0 }, b: { col: 5, row: 0 }, c: { col: 9, row: 0 } };
    const result = compactLayout(positions);
    assert.equal(result.positions.a.col, 0);
    assert.equal(result.positions.b.col, 1);
    assert.equal(result.positions.c.col, 2);
  });

  test('does not mutate the input object', () => {
    const positions = { a: { col: 0, row: 0 }, b: { col: 5, row: 0 } };
    const snapshot = JSON.parse(JSON.stringify(positions));
    compactLayout(positions);
    assert.deepEqual(positions, snapshot);
  });

  test('handles an empty positions map', () => {
    const result = compactLayout({});
    assert.deepEqual(result.positions, {});
    assert.equal(result.changed, false);
    assert.deepEqual(result.usedCols, []);
    assert.deepEqual(result.usedRows, []);
  });

  test('preserves extra fields on each position entry', () => {
    const positions = { a: { col: 0, row: 0, extra: 'keep-me' } };
    const result = compactLayout(positions);
    assert.equal(result.positions.a.extra, 'keep-me');
  });
});

describe('computeEdgeMovePosition()', () => {
  const positions = [
    { col: 0, row: 0 },
    { col: 3, row: 2 },
    { col: 1, row: 5 },
  ];

  test('left snaps column to 0 and keeps the row', () => {
    const result = computeEdgeMovePosition('left', { col: 2, row: 4 }, positions);
    assert.deepEqual(result, { col: 0, row: 4 });
  });

  test('right snaps column to one past the highest existing column', () => {
    const result = computeEdgeMovePosition('right', { col: 0, row: 4 }, positions);
    assert.deepEqual(result, { col: 4, row: 4 });
  });

  test('top snaps row to 0 and keeps the column', () => {
    const result = computeEdgeMovePosition('top', { col: 2, row: 4 }, positions);
    assert.deepEqual(result, { col: 2, row: 0 });
  });

  test('bottom snaps row to one past the highest existing row', () => {
    const result = computeEdgeMovePosition('bottom', { col: 2, row: 0 }, positions);
    assert.deepEqual(result, { col: 2, row: 6 });
  });

  test('an unrecognized direction returns the current position unchanged', () => {
    const cur = { col: 2, row: 4 };
    const result = computeEdgeMovePosition('sideways', cur, positions);
    assert.deepEqual(result, { col: 2, row: 4 });
  });
});

describe('buildBlocksAndParallel()', () => {
  test('returns empty lists for no children', () => {
    const result = buildBlocksAndParallel([], () => undefined);
    assert.deepEqual(result, { blocks: [], parallel: [] });
  });

  test('skips a child with no lookup match', () => {
    const result = buildBlocksAndParallel(['a.md'], () => undefined);
    assert.deepEqual(result, { blocks: [], parallel: [] });
  });

  test('emits a blocks edge for a blocked filename that is also a child', () => {
    const docs = { 'a.md': { blocks: ['b.md'] }, 'b.md': {} };
    const result = buildBlocksAndParallel(['a.md', 'b.md'], (fn) => docs[fn]);
    assert.deepEqual(result.blocks, [{ src: 'a.md', tgt: 'b.md' }]);
  });

  test('drops a blocks edge whose target is outside the child set', () => {
    const docs = { 'a.md': { blocks: ['outside.md'] } };
    const result = buildBlocksAndParallel(['a.md'], (fn) => docs[fn]);
    assert.deepEqual(result.blocks, []);
  });

  test('emits a parallel pair for a parallel filename that is also a child', () => {
    const docs = { 'a.md': { parallel: ['b.md'] }, 'b.md': {} };
    const result = buildBlocksAndParallel(['a.md', 'b.md'], (fn) => docs[fn]);
    assert.deepEqual(result.parallel, [{ a: 'a.md', b: 'b.md' }]);
  });

  test('deduplicates a parallel pair declared from both sides', () => {
    const docs = { 'a.md': { parallel: ['b.md'] }, 'b.md': { parallel: ['a.md'] } };
    const result = buildBlocksAndParallel(['a.md', 'b.md'], (fn) => docs[fn]);
    assert.equal(result.parallel.length, 1);
  });

  test('drops a parallel pair whose partner is outside the child set', () => {
    const docs = { 'a.md': { parallel: ['outside.md'] } };
    const result = buildBlocksAndParallel(['a.md'], (fn) => docs[fn]);
    assert.deepEqual(result.parallel, []);
  });
});

describe('computeSecEdges()', () => {
  test('returns no edges when there are no positions', () => {
    assert.deepEqual(computeSecEdges({}, []), []);
  });

  test('returns no edge for a single card in a column', () => {
    const layout = { a: { col: 0, row: 0 } };
    assert.deepEqual(computeSecEdges(layout, []), []);
  });

  test('connects two cards sharing a column in row order', () => {
    const layout = { a: { col: 0, row: 0 }, b: { col: 0, row: 1 } };
    assert.deepEqual(computeSecEdges(layout, []), [{ src: 'a', tgt: 'b' }]);
  });

  test('orders the edge by row regardless of key insertion order', () => {
    const layout = { b: { col: 0, row: 1 }, a: { col: 0, row: 0 } };
    assert.deepEqual(computeSecEdges(layout, []), [{ src: 'a', tgt: 'b' }]);
  });

  test('chains three cards in the same column into two consecutive edges', () => {
    const layout = { a: { col: 0, row: 0 }, b: { col: 0, row: 1 }, c: { col: 0, row: 2 } };
    const result = computeSecEdges(layout, []);
    assert.deepEqual(result, [
      { src: 'a', tgt: 'b' },
      { src: 'b', tgt: 'c' },
    ]);
  });

  test('does not connect cards in different columns', () => {
    const layout = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } };
    assert.deepEqual(computeSecEdges(layout, []), []);
  });

  test('omits a pair already connected by a BLOCKS edge (either direction)', () => {
    const layout = { a: { col: 0, row: 0 }, b: { col: 0, row: 1 } };
    assert.deepEqual(computeSecEdges(layout, [{ src: 'a', tgt: 'b' }]), []);
    assert.deepEqual(computeSecEdges(layout, [{ src: 'b', tgt: 'a' }]), []);
  });
});

describe('computeCanvasRanks()', () => {
  test('returns no ranks for an empty story list', () => {
    assert.deepEqual(computeCanvasRanks([], {}), []);
  });

  test('drops a story with no saved layout position', () => {
    const stories = [{ filename: 'a.md', docType: 'story' }];
    assert.deepEqual(computeCanvasRanks(stories, {}), []);
  });

  test('ranks a single positioned story as 1', () => {
    const stories = [{ filename: 'a.md', docType: 'story' }];
    const layout = { 'a.md': { col: 0, row: 0 } };
    assert.deepEqual(computeCanvasRanks(stories, layout), [
      { filename: 'a.md', docType: 'story', rank: 1 },
    ]);
  });

  test('orders by column first, left to right', () => {
    const stories = [
      { filename: 'a.md', docType: 'story' },
      { filename: 'b.md', docType: 'story' },
    ];
    const layout = { 'a.md': { col: 1, row: 0 }, 'b.md': { col: 0, row: 0 } };
    const result = computeCanvasRanks(stories, layout);
    assert.deepEqual(
      result.map((r) => r.filename),
      ['b.md', 'a.md']
    );
    assert.deepEqual(
      result.map((r) => r.rank),
      [1, 2]
    );
  });

  test('within the same column, orders by row top to bottom', () => {
    const stories = [
      { filename: 'a.md', docType: 'story' },
      { filename: 'b.md', docType: 'story' },
    ];
    const layout = { 'a.md': { col: 0, row: 2 }, 'b.md': { col: 0, row: 0 } };
    const result = computeCanvasRanks(stories, layout);
    assert.deepEqual(
      result.map((r) => r.filename),
      ['b.md', 'a.md']
    );
  });

  test('defaults a missing docType to "story"', () => {
    const stories = [{ filename: 'a.md' }];
    const layout = { 'a.md': { col: 0, row: 0 } };
    assert.deepEqual(computeCanvasRanks(stories, layout), [
      { filename: 'a.md', docType: 'story', rank: 1 },
    ]);
  });

  test('does not mutate the input stories or layout', () => {
    const stories = [{ filename: 'a.md', docType: 'story' }];
    const layout = { 'a.md': { col: 0, row: 0 } };
    const storiesSnapshot = JSON.parse(JSON.stringify(stories));
    const layoutSnapshot = JSON.parse(JSON.stringify(layout));
    computeCanvasRanks(stories, layout);
    assert.deepEqual(stories, storiesSnapshot);
    assert.deepEqual(layout, layoutSnapshot);
  });
});
