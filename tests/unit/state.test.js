// ── Unit tests: public/js/state.js ─────────────────────────────────────────────
// Pure tree/error-message helpers shared across the frontend, exercised here
// without a DOM/browser (#347). state.js also exports the event-driven store API
// re-exported from store.js — those are already covered by store.test.js.
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChildrenMap,
  getDescendants,
  getErrorMessage,
  readSSELines,
} from '../../public/js/state.js';

function makeDoc(overrides = {}) {
  return {
    filename: 'doc.md',
    docType: 'story',
    title: 'A Story',
    date: '2024-01-01',
    status: 'Draft',
    fixVersion: null,
    jiraId: null,
    jiraUrl: null,
    storyPoints: null,
    sprint: null,
    rank: null,
    priority: 'Medium',
    parentFilename: null,
    parentType: null,
    blocks: [],
    blockedBy: [],
    parallel: [],
    pi: null,
    team: null,
    workCategory: null,
    hasDescription: false,
    descriptionSnippet: null,
    ...overrides,
  };
}

// ── buildChildrenMap ──────────────────────────────────────────────────────────
describe('buildChildrenMap', () => {
  test('groups docs by their parentFilename', () => {
    const parent = makeDoc({ filename: 'epic.md' });
    const child1 = makeDoc({ filename: 'story1.md', parentFilename: 'epic.md' });
    const child2 = makeDoc({ filename: 'story2.md', parentFilename: 'epic.md' });
    const map = buildChildrenMap([parent, child1, child2]);
    assert.deepEqual(
      map.get('epic.md').map((d) => d.filename),
      ['story1.md', 'story2.md']
    );
  });

  test('docs with no parentFilename are excluded from the map', () => {
    const orphan = makeDoc({ filename: 'root.md', parentFilename: null });
    const map = buildChildrenMap([orphan]);
    assert.equal(map.size, 0);
  });

  test('empty input returns an empty map', () => {
    const map = buildChildrenMap([]);
    assert.equal(map.size, 0);
  });
});

// ── getDescendants ────────────────────────────────────────────────────────────
describe('getDescendants', () => {
  test('returns all descendants across multiple generations', () => {
    const epic = makeDoc({ filename: 'epic.md' });
    const feature = makeDoc({ filename: 'feature.md', parentFilename: 'epic.md' });
    const story = makeDoc({ filename: 'story.md', parentFilename: 'feature.md' });
    const childrenMap = buildChildrenMap([epic, feature, story]);
    const descendants = getDescendants('epic.md', childrenMap);
    assert.deepEqual(
      descendants.map((d) => d.filename),
      ['feature.md', 'story.md']
    );
  });

  test('a leaf with no children returns an empty array', () => {
    const story = makeDoc({ filename: 'story.md' });
    const childrenMap = buildChildrenMap([story]);
    assert.deepEqual(getDescendants('story.md', childrenMap), []);
  });

  test('an unknown filename (not in the map) returns an empty array', () => {
    const childrenMap = buildChildrenMap([makeDoc({ filename: 'a.md' })]);
    assert.deepEqual(getDescendants('nonexistent.md', childrenMap), []);
  });
});

// ── getErrorMessage ───────────────────────────────────────────────────────────
describe('getErrorMessage', () => {
  test('returns a string error value as-is', () => {
    assert.equal(getErrorMessage('Something broke'), 'Something broke');
  });

  test('extracts .message from an object-shaped error', () => {
    assert.equal(getErrorMessage({ message: 'Validation failed' }), 'Validation failed');
  });

  test('falls back to the default message for a falsy/empty error value', () => {
    assert.equal(getErrorMessage(null), 'Request failed');
    assert.equal(getErrorMessage(undefined), 'Request failed');
  });

  test('falls back to a custom fallback message when provided', () => {
    assert.equal(getErrorMessage(null, 'Custom fallback'), 'Custom fallback');
    assert.equal(getErrorMessage({}, 'Custom fallback'), 'Custom fallback');
  });
});

// ── readSSELines (#542) ──────────────────────────────────────────────────────
// The low-level line-framing loop extracted out of streamSSE() so
// bugs-dashboard.ts's loadBugsDashboard() (GET, differently-shaped chunks)
// could build on it too instead of reimplementing the read/decode/buffer/split
// loop from scratch.
function makeSSEResponse(byteChunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of byteChunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream);
}

function textChunks(...strings) {
  const encoder = new TextEncoder();
  return strings.map((s) => encoder.encode(s));
}

describe('readSSELines', () => {
  test('parses multiple "data: " lines delivered in a single chunk', async () => {
    const res = makeSSEResponse(textChunks('data: {"a":1}\n\ndata: {"a":2}\n\n'));
    const received = [];
    await readSSELines(res, (raw) => received.push(raw));
    assert.deepEqual(received, ['{"a":1}', '{"a":2}']);
  });

  test('reassembles a "data: " line split across two chunks', async () => {
    const res = makeSSEResponse(textChunks('data: {"a":1', '23}\n'));
    const received = [];
    await readSSELines(res, (raw) => received.push(raw));
    assert.deepEqual(received, ['{"a":123}']);
  });

  test('ignores non-"data: " lines (SSE comments, blank lines)', async () => {
    const res = makeSSEResponse(textChunks(': keep-alive\ndata: {"x":true}\n\n'));
    const received = [];
    await readSSELines(res, (raw) => received.push(raw));
    assert.deepEqual(received, ['{"x":true}']);
  });

  test('a trailing line with no terminating newline is dropped, matching the buffered-remainder convention', async () => {
    const res = makeSSEResponse(textChunks('data: {"a":1}\n', 'data: {"a":2}'));
    const received = [];
    await readSSELines(res, (raw) => received.push(raw));
    assert.deepEqual(received, ['{"a":1}']);
  });

  test('reassembles a multi-byte UTF-8 character split across a chunk boundary', async () => {
    const encoder = new TextEncoder();
    const full = encoder.encode('data: {"emoji":"🎉"}\n');
    // Split mid-way through the emoji's 4-byte UTF-8 sequence.
    const res = makeSSEResponse([full.slice(0, 12), full.slice(12)]);
    const received = [];
    await readSSELines(res, (raw) => received.push(raw));
    assert.deepEqual(received, ['{"emoji":"🎉"}']);
  });

  test('onChunk is called once per line, in order', async () => {
    const res = makeSSEResponse(textChunks('data: 1\ndata: 2\ndata: 3\n'));
    const received = [];
    await readSSELines(res, (raw) => received.push(raw));
    assert.deepEqual(received, ['1', '2', '3']);
  });
});
