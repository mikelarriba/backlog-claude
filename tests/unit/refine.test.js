// ── Unit tests: public/js/refine.js's canvas search classifier ─────────────
// classifyCanvasSearchMatch is the pure per-card decision backing
// onCanvasSearch (the refine canvas's search box, wired via the
// data-input-action registry): below the 3-char minimum every card is
// unfiltered, at/above it a case-insensitive substring match on the title
// wins 'match' and everything else 'dimmed'. Previously inlined in
// onCanvasSearch's forEach alongside the classList writes; extracted so the
// matching rule is unit-testable without a DOM.
//
// refine.js statically imports state.js, list.js, detail.js,
// detail-fields.js, refine-canvas.js, refine-edges.js, refine-nodes.js, and
// actions.js — the rest of the DOM-entangled app graph (same chain
// mockRoadmapDeps.js's comment describes). classifyCanvasSearchMatch never
// calls into any of them, so each heavy neighbor is mocked out below with
// only the named exports refine.js actually imports (same mock-the-heavy-
// neighbor pattern as detail.test.js/bugcreate.test.js). state.js and
// actions.js are left real: both are foundational with no heavy imports of
// their own, and actions.js's registerActions/registerInputActions/
// registerKeydownActions calls at refine.js's module top level need to run
// for real to prove the module still loads cleanly.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {} },
});
mock.module('../../public/js/detail.js', {
  namedExports: { openDoc: () => {} },
});
mock.module('../../public/js/detail-fields.js', {
  namedExports: { _parseComments: () => [], _renderComments: () => {} },
});
mock.module('../../public/js/refine-canvas.js', {
  namedExports: {
    buildCanvasGraph: async () => {},
    renderCanvas: () => {},
    rebuildCanvasEdges: () => {},
    _renderFpCanvas: () => {},
    computeAutoLayout: () => {},
  },
});
mock.module('../../public/js/refine-edges.js', {
  namedExports: { _closeLinkPopup: () => {}, toggleManageLinks: () => {} },
});
mock.module('../../public/js/refine-nodes.js', {
  namedExports: { _fpCreateChild: async () => {}, _showEpicContextMenu: () => {} },
});

const { classifyCanvasSearchMatch } = await import('../../public/js/refine.js');

describe('classifyCanvasSearchMatch()', () => {
  test('returns "none" for a query shorter than 3 characters', () => {
    assert.equal(classifyCanvasSearchMatch('Login Flow', 'lo'), 'none');
  });

  test('returns "none" for an empty query', () => {
    assert.equal(classifyCanvasSearchMatch('Login Flow', ''), 'none');
  });

  test('returns "none" for a query that is only whitespace padding around 2 chars', () => {
    assert.equal(classifyCanvasSearchMatch('Login Flow', '  lo  '), 'none');
  });

  test('returns "match" on a case-insensitive substring hit', () => {
    assert.equal(classifyCanvasSearchMatch('Login Flow', 'LOGIN'), 'match');
  });

  test('returns "match" when the query matches mid-title', () => {
    assert.equal(classifyCanvasSearchMatch('User Login Flow', 'log'), 'match');
  });

  test('returns "dimmed" when the query is long enough but does not match', () => {
    assert.equal(classifyCanvasSearchMatch('Login Flow', 'xyz'), 'dimmed');
  });

  test('returns "dimmed" for an empty title with a valid query', () => {
    assert.equal(classifyCanvasSearchMatch('', 'abc'), 'dimmed');
  });

  test('trims surrounding whitespace off the query before matching', () => {
    assert.equal(classifyCanvasSearchMatch('Login Flow', '  login  '), 'match');
  });
});
