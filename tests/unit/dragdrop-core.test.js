import { mock, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

// dragdrop-core is pure logic, but it still imports _rankSortFn from
// list-render.js, which pulls in the same detail/list chain dragdrop.test.js
// mocks out (the functions under test never call into them).
mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});
const core = await import('../../public/js/dragdrop-core.js');
const docs = ['a', 'b', 'c'].map((f, i) => ({ filename: f, docType: 'story', rank: i + 1 }));

describe('dragdrop-core', () => {
  it('computeRerankedOrder moves before target / to end', () => {
    assert.deepEqual(core.computeRerankedOrder(docs, 'c', 'a'), ['c', 'a', 'b']);
    assert.deepEqual(core.computeRerankedOrder(docs, 'a', null), ['b', 'c', 'a']);
    assert.equal(core.computeRerankedOrder(docs, 'zzz', null), null);
  });
  it('computeSelectionMove handles edges and no-ops', () => {
    assert.deepEqual(core.computeSelectionMove(docs, new Set(['b']), 'top'), ['b', 'a', 'c']);
    assert.equal(core.computeSelectionMove(docs, new Set(['a']), 'up'), null);
  });
  it('computeAdjacentSwimlane walks the section order', () => {
    assert.equal(core.computeAdjacentSwimlane('currentPi', 'next'), 'nextPi');
    assert.equal(core.computeAdjacentSwimlane('currentPi', 'prev'), undefined);
  });
  it('announcements and drop zone', () => {
    assert.equal(core.buildSelectionMoveAnnouncement(2, 'top'), 'Moved 2 items to the top.');
    assert.equal(core.isCenterDropZone(50, 100), true);
    assert.equal(core.isCenterDropZone(10, 100), false);
  });
});
