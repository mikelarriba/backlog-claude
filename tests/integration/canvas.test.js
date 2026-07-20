// ── Integration tests: canvas layout endpoints (#420, #421) ────────────────────
// src/routes/canvas.ts (GET/PUT/DELETE layout) had zero test coverage before
// this file. Covers the get/save/delete round trip, the position-shape
// validation on PUT, and the "__proto__" prototype-pollution guard fixed
// alongside #420.
//
// Note: canvas.ts persists to <repoRoot>/.canvas-layout.json (not a per-test
// tmp dir — see src/app/routes.ts), so this suite cleans up the file it
// touches instead of relying on startTestApp()'s tmp-dir teardown. All canvas
// tests live in this one file (rather than split across files) because
// node's test runner runs separate files concurrently by default, and
// concurrent tests writing the same shared, non-tmp-dir file would race.
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

describe('GET/PUT/DELETE /api/canvas/layout/:epicFilename', () => {
  const filename = '2026-01-01-canvas-round-trip-epic.md';

  after(() => {
    fs.rmSync(layoutPath, { force: true });
  });

  test('GET returns an empty object when no layout has been saved yet', async () => {
    const { status, data } = await api('GET', `/api/canvas/layout/${encodeURIComponent(filename)}`);
    assert.equal(status, 200);
    assert.deepEqual(data, {});
  });

  test('PUT saves a layout and persists it to disk', async () => {
    const { status, data } = await api(
      'PUT',
      `/api/canvas/layout/${encodeURIComponent(filename)}`,
      { positions: { 'card-1': { col: 0, row: 0 }, 'card-2': { col: 1, row: 0 } } }
    );
    assert.equal(status, 200);
    assert.deepEqual(data, { success: true });

    assert.ok(fs.existsSync(layoutPath), 'layout file should be created on disk');
    const onDisk = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
    assert.deepEqual(onDisk[filename], {
      'card-1': { col: 0, row: 0 },
      'card-2': { col: 1, row: 0 },
    });
  });

  test('GET returns the saved layout', async () => {
    const { status, data } = await api('GET', `/api/canvas/layout/${encodeURIComponent(filename)}`);
    assert.equal(status, 200);
    assert.deepEqual(data, { 'card-1': { col: 0, row: 0 }, 'card-2': { col: 1, row: 0 } });
  });

  test('PUT overwrites the previous layout for the same filename', async () => {
    const { status } = await api('PUT', `/api/canvas/layout/${encodeURIComponent(filename)}`, {
      positions: { 'card-3': { col: 5, row: 2 } },
    });
    assert.equal(status, 200);

    const { data } = await api('GET', `/api/canvas/layout/${encodeURIComponent(filename)}`);
    assert.deepEqual(data, { 'card-3': { col: 5, row: 2 } });
  });

  test('PUT rejects a missing positions field', async () => {
    const { status, data } = await api(
      'PUT',
      `/api/canvas/layout/${encodeURIComponent(filename)}`,
      {}
    );
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('PUT rejects a non-integer or negative col/row', async () => {
    const badShapes = [
      { 'card-1': { col: -1, row: 0 } },
      { 'card-1': { col: 0, row: -1 } },
      { 'card-1': { col: 1.5, row: 0 } },
      { 'card-1': { col: 'zero', row: 0 } },
    ];
    for (const positions of badShapes) {
      const { status, data } = await api(
        'PUT',
        `/api/canvas/layout/${encodeURIComponent(filename)}`,
        { positions }
      );
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(positions)}`);
      assert.equal(data.code, 'VALIDATION_ERROR');
    }
  });

  test('DELETE clears the layout for this filename only', async () => {
    const otherFilename = '2026-01-01-canvas-other-epic.md';
    await api('PUT', `/api/canvas/layout/${encodeURIComponent(otherFilename)}`, {
      positions: { 'card-x': { col: 9, row: 9 } },
    });

    const { status, data } = await api(
      'DELETE',
      `/api/canvas/layout/${encodeURIComponent(filename)}`
    );
    assert.equal(status, 200);
    assert.deepEqual(data, { success: true });

    const cleared = await api('GET', `/api/canvas/layout/${encodeURIComponent(filename)}`);
    assert.deepEqual(cleared.data, {});

    // The other epic's layout must survive this epic's delete.
    const other = await api('GET', `/api/canvas/layout/${encodeURIComponent(otherFilename)}`);
    assert.deepEqual(other.data, { 'card-x': { col: 9, row: 9 } });
  });

  test('DELETE on a filename with no saved layout is a no-op success', async () => {
    const { status, data } = await api(
      'DELETE',
      `/api/canvas/layout/${encodeURIComponent('2026-01-01-never-saved.md')}`
    );
    assert.equal(status, 200);
    assert.deepEqual(data, { success: true });
  });
});

describe('PUT /api/canvas/layout/:epicFilename — prototype pollution guard (#420)', () => {
  // A filename of "__proto__" doesn't pollute the global Object.prototype
  // (bracket assignment only rewires that one in-memory object's own
  // [[Prototype]]), but it silently corrupted the persisted layout: once
  // `layout.__proto__ = positions` ran, `layout` had zero *own* enumerable
  // properties, so `JSON.stringify(layout)` wrote "{}" to disk — the PUT
  // appeared to succeed but the data (and every other epic's saved layout)
  // was discarded in the same write. canvas.ts builds the layout with
  // Object.create(null) so "__proto__" is just a regular own key.
  after(() => {
    fs.rmSync(layoutPath, { force: true });
  });

  test('a "__proto__" filename round-trips instead of silently discarding the write', async () => {
    // Save a normal epic's layout first — this is what a naive `layout[fn] = positions`
    // would lose once "__proto__" rewrites layout's own prototype chain.
    const otherFilename = '2026-01-01-proto-guard-other-epic.md';
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
});
