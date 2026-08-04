// ── Integration tests: POST /api/docs/rerank and /api/docs/rerank-canvas ──────
// Siblings apply-distribution/batch-delete already had coverage
// (write-permission-errors.test.js); rerank/rerank-canvas did not.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp } from '../helpers/testApp.js';

let api, stop, docsRoot;

before(async () => {
  ({ api, stop, docsRoot } = await startTestApp());
});

after(async () => {
  await stop();
});

// applyDocPatch writes Rank via js-yaml, which quotes numeric-looking string
// values (e.g. `Rank: '3'`) to preserve their string type — read back with
// the quotes stripped so tests assert on the logical value, not YAML syntax.
function readRank(subdir, filename) {
  const content = fs.readFileSync(path.join(docsRoot, subdir, filename), 'utf-8');
  const m = content.match(/^Rank:\s*'?(.+?)'?$/m);
  return m ? m[1] : null;
}

// ── POST /api/docs/rerank ──────────────────────────────────────────────────────
describe('POST /api/docs/rerank — validation', () => {
  test('returns 400 when orderedFilenames is empty', async () => {
    const { status, data } = await api('POST', '/api/docs/rerank', {
      type: 'story',
      orderedFilenames: [],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when type is missing', async () => {
    const { status, data } = await api('POST', '/api/docs/rerank', {
      orderedFilenames: ['a.md'],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 INVALID_TYPE for an unknown document type', async () => {
    const { status, data } = await api('POST', '/api/docs/rerank', {
      type: 'not-a-real-type',
      orderedFilenames: ['a.md'],
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'INVALID_TYPE');
  });
});

describe('POST /api/docs/rerank — happy path', () => {
  test('assigns Rank 1..N in the given order and skips unknown filenames', async () => {
    const { data: s1 } = await api('POST', '/api/docs/draft', {
      title: 'Rerank Story A',
      type: 'story',
    });
    const { data: s2 } = await api('POST', '/api/docs/draft', {
      title: 'Rerank Story B',
      type: 'story',
    });

    const { status, data } = await api('POST', '/api/docs/rerank', {
      type: 'story',
      orderedFilenames: [s2.filename, s1.filename, 'nonexistent-story.md'],
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.equal(data.updated, 2);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.skipped[0].filename, 'nonexistent-story.md');
    assert.equal(data.skipped[0].reason, 'not found');

    assert.equal(readRank('stories', s2.filename), '1');
    assert.equal(readRank('stories', s1.filename), '2');
  });

  test('reflects the new rank via GET /api/docs', async () => {
    const { data: e1 } = await api('POST', '/api/docs/draft', {
      title: 'Rerank Epic A',
      type: 'epic',
    });
    const { data: e2 } = await api('POST', '/api/docs/draft', {
      title: 'Rerank Epic B',
      type: 'epic',
    });

    await api('POST', '/api/docs/rerank', {
      type: 'epic',
      orderedFilenames: [e2.filename, e1.filename],
    });

    const { data: docs } = await api('GET', '/api/docs');
    const doc2 = docs.find((d) => d.filename === e2.filename);
    const doc1 = docs.find((d) => d.filename === e1.filename);
    assert.equal(doc2.rank, 1);
    assert.equal(doc1.rank, 2);
  });
});

// ── POST /api/docs/rerank-canvas ──────────────────────────────────────────────
describe('POST /api/docs/rerank-canvas — validation', () => {
  test('returns 400 when items is empty', async () => {
    const { status, data } = await api('POST', '/api/docs/rerank-canvas', { items: [] });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when a required item field is missing', async () => {
    const { status, data } = await api('POST', '/api/docs/rerank-canvas', {
      items: [{ filename: 'a.md', docType: 'story' }], // missing rank
    });
    assert.equal(status, 400);
    assert.equal(data.code, 'VALIDATION_ERROR');
  });
});

describe('POST /api/docs/rerank-canvas — happy path', () => {
  test('assigns the given ranks across mixed doc types and skips unknowns', async () => {
    const { data: story } = await api('POST', '/api/docs/draft', {
      title: 'Canvas Rerank Story',
      type: 'story',
    });
    const { data: spike } = await api('POST', '/api/docs/draft', {
      title: 'Canvas Rerank Spike',
      type: 'spike',
    });

    const { status, data } = await api('POST', '/api/docs/rerank-canvas', {
      items: [
        { filename: story.filename, docType: 'story', rank: 5 },
        { filename: spike.filename, docType: 'spike', rank: 7 },
        { filename: 'ghost.md', docType: 'story', rank: 1 },
      ],
    });

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    assert.equal(data.success, true);
    assert.equal(data.updated, 2);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.skipped[0].filename, 'ghost.md');

    assert.equal(readRank('stories', story.filename), '5');
    assert.equal(readRank('spikes', spike.filename), '7');
  });

  test('an invalid docType inside items is caught per-entry and reported as skipped (200, not 400)', async () => {
    const { status, data } = await api('POST', '/api/docs/rerank-canvas', {
      items: [{ filename: 'whatever.md', docType: 'not-a-real-type', rank: 1 }],
    });
    assert.equal(status, 200);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.updated, 0);
  });
});
