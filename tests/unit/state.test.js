// ── Unit tests: public/js/state.js ─────────────────────────────────────────────
// Pure tree/error-message helpers shared across the frontend, exercised here
// without a DOM/browser (#347). state.js also exports the event-driven store API
// re-exported from store.js — those are already covered by store.test.js.
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildChildrenMap, getDescendants, getErrorMessage } from '../../public/js/state.js';

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
