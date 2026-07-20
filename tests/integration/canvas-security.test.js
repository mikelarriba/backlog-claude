// ── Integration test: canvas layout prototype-pollution guard (#420) ───────────
// PUT /api/canvas/layout/:epicFilename used a plain object keyed by the
// (attacker-controlled) filename param. A filename of "__proto__" doesn't
// pollute the global Object.prototype (bracket assignment only rewires that
// one in-memory object's own [[Prototype]]), but it silently corrupts the
// persisted layout: once `layout.__proto__ = positions` runs, `layout` has
// zero *own* enumerable properties, so `JSON.stringify(layout)` writes "{}"
// to disk — the PUT appears to succeed but the data is lost, and every
// other epic's saved layout is discarded in the same write. canvas.ts now
// builds the layout with Object.create(null) so "__proto__" is just a
// regular own key like any other filename.
//
// Note: canvas.ts persists to <repoRoot>/.canvas-layout.json (not a
// per-test tmp dir — see src/app/routes.ts), so this suite cleans up the
// file it touches instead of relying on startTestApp()'s tmp-dir teardown.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp } from '../helpers/testApp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutPath = path.resolve(__dirname, '../../.canvas-layout.json');

let api, stop;

before(async () => {
  ({ api, stop } = await startTestApp());
});

after(async () => {
  await stop();
  fs.rmSync(layoutPath, { force: true });
});

describe('PUT /api/canvas/layout/:epicFilename — prototype pollution guard', () => {
  after(() => {
    fs.rmSync(layoutPath, { force: true });
  });

  test('a "__proto__" filename round-trips instead of silently discarding the write', async () => {
    // Save a normal epic's layout first — this is what a naive `layout[fn] = positions`
    // would lose once "__proto__" rewrites layout's own prototype chain.
    const otherFilename = '2026-01-01-other-epic.md';
    const otherPut = await api('PUT', `/api/canvas/layout/${encodeURIComponent(otherFilename)}`, {
      positions: { 'card-x': { col: 1, row: 1 } },
    });
    assert.equal(otherPut.status, 200);

    const { status } = await api('PUT', '/api/canvas/layout/__proto__', {
      positions: { 'card-1': { col: 0, row: 0 } },
    });
    assert.equal(status, 200);

    const protoGet = await api('GET', '/api/canvas/layout/__proto__');
    assert.deepEqual(
      protoGet.data,
      { 'card-1': { col: 0, row: 0 } },
      'the "__proto__" layout itself must persist'
    );

    const otherGet = await api('GET', `/api/canvas/layout/${encodeURIComponent(otherFilename)}`);
    assert.deepEqual(
      otherGet.data,
      { 'card-x': { col: 1, row: 1 } },
      'a sibling epic layout saved earlier must survive the "__proto__" write'
    );
  });

  test('round-trips a normal layout unaffected by the guard', async () => {
    const filename = '2026-01-01-canvas-epic.md';
    const putRes = await api('PUT', `/api/canvas/layout/${encodeURIComponent(filename)}`, {
      positions: { 'card-1': { col: 2, row: 3 } },
    });
    assert.equal(putRes.status, 200);

    const getRes = await api('GET', `/api/canvas/layout/${encodeURIComponent(filename)}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.data, { 'card-1': { col: 2, row: 3 } });
  });
});
