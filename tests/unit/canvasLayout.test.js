// ── Unit tests: public/js/canvasLayout.js ─────────────────────────────────────
// Pure layout computation for the refine canvas — deterministic math with no
// DOM access, explicitly documented as safe to unit-test in isolation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoLayout } from '../../public/js/canvasLayout.js';

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
