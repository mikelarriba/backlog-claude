// ── Unit tests: public/js/bugcreate.js (pure byte-size formatter) ──────────
// formatBytes turns a raw byte count into the "12.3 KB" label shown next to
// each attached file in renderBugFileList — exactly the kind of formatting
// helper that regresses silently at a unit boundary (1023 vs 1024, KB vs MB).
// bugcreate.js statically imports list.js and detail.js, which pull in the
// rest of the DOM-entangled app graph (list-filters.js -> detail.js ->
// main.js -> ... -> bugcreate.js itself, an existing circular dependency —
// see mockRoadmapDeps.js's note on the same chain), so both are mocked out
// below with only the named exports bugcreate.js actually calls; formatBytes
// never calls into either. bugcreate.js also registers a
// `document.addEventListener('DOMContentLoaded', ...)` listener at its own
// module top level (wiring the drop-zone), so `document` needs a minimal
// stub — there's no real DOM in these tests — in addition to the
// domGlobals window shim used across the other frontend unit tests.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.document = { addEventListener: () => {} };
}

mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {} },
});
mock.module('../../public/js/detail.js', {
  namedExports: { openDoc: () => {} },
});

const { formatBytes } = await import('../../public/js/bugcreate.js');

describe('formatBytes()', () => {
  test('zero bytes', () => {
    assert.equal(formatBytes(0), '0 B');
  });

  test('bytes below the 1024 KB threshold are shown as whole bytes', () => {
    assert.equal(formatBytes(500), '500 B');
    assert.equal(formatBytes(1023), '1023 B');
  });

  test('exactly 1024 bytes crosses into KB', () => {
    assert.equal(formatBytes(1024), '1.0 KB');
  });

  test('KB values round to one decimal place', () => {
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(2048), '2.0 KB');
  });

  test('bytes just below the 1 MB threshold stay in KB', () => {
    assert.equal(formatBytes(1024 * 1024 - 1), '1024.0 KB');
  });

  test('exactly 1 MB crosses into MB', () => {
    assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  });

  test('MB values round to one decimal place', () => {
    assert.equal(formatBytes(5.5 * 1024 * 1024), '5.5 MB');
  });

  test('large MB values are not further abbreviated to GB', () => {
    assert.equal(formatBytes(1024 * 1024 * 1024), '1024.0 MB');
  });
});
