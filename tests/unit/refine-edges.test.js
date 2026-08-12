// ── Unit tests: public/js/refine-edges.js ───────────────────────────────────
// Pure alt-link-type, target-validity, and link-payload helpers extracted
// from the canvas edge/link-popup flow (#460), exercised without a DOM.
// refine-edges.js is part of the same refine.js <-> list.js <-> detail.js
// circular import chain documented in dragdrop.test.js and
// refine-canvas.test.js, so detail.js and list.js are mocked out before the
// dynamic import below; the functions under test never call into them.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {}, openDoc: () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});

const { computeAltLinkType, isLinkableTargetDocType, buildLinkPayload } =
  await import('../../public/js/refine-edges.js');

// ── computeAltLinkType ───────────────────────────────────────────────────────
describe('computeAltLinkType()', () => {
  test('blocks flips to parallel with the PARALLEL label', () => {
    assert.deepEqual(computeAltLinkType('blocks'), {
      altType: 'parallel',
      altLabel: 'Change to PARALLEL',
    });
  });

  test('parallel flips to blocks with the BLOCKS label', () => {
    assert.deepEqual(computeAltLinkType('parallel'), {
      altType: 'blocks',
      altLabel: 'Change to BLOCKS',
    });
  });

  test('any non-blocks value is treated as flipping to blocks', () => {
    assert.deepEqual(computeAltLinkType('unknown'), {
      altType: 'blocks',
      altLabel: 'Change to BLOCKS',
    });
  });
});

// ── isLinkableTargetDocType ──────────────────────────────────────────────────
describe('isLinkableTargetDocType()', () => {
  test('story, spike, and bug are linkable targets', () => {
    assert.equal(isLinkableTargetDocType('story'), true);
    assert.equal(isLinkableTargetDocType('spike'), true);
    assert.equal(isLinkableTargetDocType('bug'), true);
  });

  test('epic is rejected as a link target', () => {
    assert.equal(isLinkableTargetDocType('epic'), false);
  });

  test('unknown or empty doc types are rejected', () => {
    assert.equal(isLinkableTargetDocType('feature'), false);
    assert.equal(isLinkableTargetDocType(''), false);
  });
});

// ── buildLinkPayload ─────────────────────────────────────────────────────────
describe('buildLinkPayload()', () => {
  test('maps src/tgt params onto the source/target API field names', () => {
    assert.deepEqual(buildLinkPayload('blocks', 'a.md', 'story', 'b.md', 'bug'), {
      linkType: 'blocks',
      sourceType: 'story',
      sourceFilename: 'a.md',
      targetType: 'bug',
      targetFilename: 'b.md',
    });
  });

  test('does not transpose source and target fields', () => {
    const payload = buildLinkPayload('parallel', 'src.md', 'spike', 'tgt.md', 'story');
    assert.equal(payload.sourceFilename, 'src.md');
    assert.equal(payload.sourceType, 'spike');
    assert.equal(payload.targetFilename, 'tgt.md');
    assert.equal(payload.targetType, 'story');
  });

  test('preserves the given linkType verbatim', () => {
    assert.equal(buildLinkPayload('parallel', 'a', 'story', 'b', 'story').linkType, 'parallel');
  });
});
