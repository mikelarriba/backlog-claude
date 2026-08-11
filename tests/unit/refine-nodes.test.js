// ── Unit tests: public/js/refine-nodes.js ────────────────────────────────────
// Pure request-body-field logic extracted from the empty-cell "generate &
// link" flow (_executeEmptyCellCreate) and the split flow
// (_executeCanvasSplit) (#460), exercised without a DOM. refine-nodes.js is
// part of the same refine.js <-> list.js <-> detail.js circular import
// chain documented in dragdrop.test.js, so detail.js and list.js are
// mocked out before the dynamic import below; the function under test
// never calls into them.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {}, openDoc: () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});

const { buildParentLinkFields } = await import('../../public/js/refine-nodes.js');

// ── buildParentLinkFields ─────────────────────────────────────────────────────
describe('buildParentLinkFields()', () => {
  test('inherits fixVersion and pi from the parent doc', () => {
    const parentDoc = { fixVersion: 'PI-2026.1', pi: 'PI-2026.1' };
    assert.deepEqual(buildParentLinkFields(parentDoc, 'epic', 'epic1.md'), {
      fixVersion: 'PI-2026.1',
      pi: 'PI-2026.1',
      parentEpic: 'epic1.md',
    });
  });

  test('omits pi when the parent doc\'s pi is the "TBD" placeholder', () => {
    const parentDoc = { fixVersion: 'PI-2026.1', pi: 'TBD' };
    const fields = buildParentLinkFields(parentDoc, 'epic', 'epic1.md');
    assert.equal('pi' in fields, false);
    assert.equal(fields.fixVersion, 'PI-2026.1');
  });

  test('omits fixVersion/pi entirely when the parent doc has neither set', () => {
    const parentDoc = { fixVersion: null, pi: null };
    const fields = buildParentLinkFields(parentDoc, 'epic', 'epic1.md');
    assert.equal('fixVersion' in fields, false);
    assert.equal('pi' in fields, false);
  });

  test('an undefined parent doc still resolves the parent* field from epicDocType', () => {
    assert.deepEqual(buildParentLinkFields(undefined, 'feature', 'feat1.md'), {
      parentFeature: 'feat1.md',
    });
  });

  test('epicDocType "epic" sets parentEpic, not parentFeature', () => {
    const fields = buildParentLinkFields(undefined, 'epic', 'epic1.md');
    assert.deepEqual(fields, { parentEpic: 'epic1.md' });
  });

  test('epicDocType "feature" sets parentFeature, not parentEpic', () => {
    const fields = buildParentLinkFields(undefined, 'feature', 'feat1.md');
    assert.deepEqual(fields, { parentFeature: 'feat1.md' });
  });

  test('an epicDocType that is neither "epic" nor "feature" sets neither parent field', () => {
    const fields = buildParentLinkFields(undefined, 'story', 'story1.md');
    assert.deepEqual(fields, {});
  });
});
