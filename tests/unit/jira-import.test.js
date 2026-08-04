// ── Unit tests: public/js/jira-import.js ────────────────────────────────────
// Pure key-parsing, children-merging, and count/grouping helpers extracted
// from the JIRA import/children-download flow (#460). jira-import.js only
// imports state.js (no DOM-heavy transitive imports), so no module mocking
// is needed here — just the window shim state.js relies on.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';
import {
  parseJiraKeysInput,
  mergeChildrenResults,
  summarizeChildrenCounts,
  groupSelectedChildrenByParent,
} from '../../public/js/jira-import.js';

// ── parseJiraKeysInput ───────────────────────────────────────────────────────
describe('parseJiraKeysInput()', () => {
  test('splits on commas and uppercases keys', () => {
    assert.deepEqual(parseJiraKeysInput('proj-1,proj-2'), ['PROJ-1', 'PROJ-2']);
  });

  test('splits on whitespace', () => {
    assert.deepEqual(parseJiraKeysInput('PROJ-1 PROJ-2   PROJ-3'), ['PROJ-1', 'PROJ-2', 'PROJ-3']);
  });

  test('handles mixed commas, spaces, and newlines', () => {
    assert.deepEqual(parseJiraKeysInput('PROJ-1,  PROJ-2\nPROJ-3'), ['PROJ-1', 'PROJ-2', 'PROJ-3']);
  });

  test('trims surrounding whitespace on each key', () => {
    assert.deepEqual(parseJiraKeysInput('  proj-1  ,  proj-2  '), ['PROJ-1', 'PROJ-2']);
  });

  test('drops empty segments from repeated separators', () => {
    assert.deepEqual(parseJiraKeysInput('PROJ-1,,  ,PROJ-2'), ['PROJ-1', 'PROJ-2']);
  });

  test('empty input yields an empty array', () => {
    assert.deepEqual(parseJiraKeysInput(''), []);
  });
});

// ── mergeChildrenResults ─────────────────────────────────────────────────────
describe('mergeChildrenResults()', () => {
  function parent(key, extra = {}) {
    return { key, filename: `${key}.md`, docType: 'epic', ...extra };
  }
  function child(key, extra = {}) {
    return { key, summary: `Summary ${key}`, issuetype: 'Story', ...extra };
  }

  test('merges children from multiple parents into one list', () => {
    const p1 = parent('EPIC-1');
    const p2 = parent('EPIC-2');
    const map = new Map([
      ['EPIC-1', [child('C-1')]],
      ['EPIC-2', [child('C-2')]],
    ]);
    const { allChildren } = mergeChildrenResults([p1, p2], map);
    assert.deepEqual(
      allChildren.map((c) => c.key),
      ['C-1', 'C-2']
    );
  });

  test('deduplicates a child key shared by two parents, keeping the first parent seen', () => {
    const p1 = parent('EPIC-1');
    const p2 = parent('EPIC-2');
    const map = new Map([
      ['EPIC-1', [child('SHARED')]],
      ['EPIC-2', [child('SHARED')]],
    ]);
    const { allChildren, childToParent } = mergeChildrenResults([p1, p2], map);
    assert.equal(allChildren.length, 1);
    assert.equal(childToParent.get('SHARED').key, 'EPIC-1');
  });

  test('a parent with no fetched children (e.g. failed fetch) contributes nothing', () => {
    const p1 = parent('EPIC-1');
    const map = new Map(); // EPIC-1 never set — fetch failed
    const { allChildren, childToParent } = mergeChildrenResults([p1], map);
    assert.deepEqual(allChildren, []);
    assert.equal(childToParent.size, 0);
  });

  test('maps issuetype -> type and preserves localExists', () => {
    const p1 = parent('EPIC-1');
    const map = new Map([['EPIC-1', [child('C-1', { issuetype: 'Bug', localExists: true })]]]);
    const { allChildren } = mergeChildrenResults([p1], map);
    assert.equal(allChildren[0].type, 'Bug');
    assert.equal(allChildren[0].localExists, true);
  });

  test('childToParent maps every distinct child key to its owning parent', () => {
    const p1 = parent('EPIC-1');
    const map = new Map([['EPIC-1', [child('C-1'), child('C-2')]]]);
    const { childToParent } = mergeChildrenResults([p1], map);
    assert.equal(childToParent.get('C-1').key, 'EPIC-1');
    assert.equal(childToParent.get('C-2').key, 'EPIC-1');
  });
});

// ── summarizeChildrenCounts ───────────────────────────────────────────────────
describe('summarizeChildrenCounts()', () => {
  test('counts new (no localExists) vs. to-update (localExists) separately', () => {
    const children = [{ localExists: false }, { localExists: false }, { localExists: true }];
    assert.equal(summarizeChildrenCounts(children), '2 new, 1 to update');
  });

  test('omits a zero segment', () => {
    assert.equal(summarizeChildrenCounts([{ localExists: true }]), '1 to update');
  });

  test('empty list yields an empty string', () => {
    assert.equal(summarizeChildrenCounts([]), '');
  });
});

// ── groupSelectedChildrenByParent ─────────────────────────────────────────────
describe('groupSelectedChildrenByParent()', () => {
  test('groups selected children under their owning parent, preserving parentIssues order', () => {
    const p1 = { key: 'EPIC-1', filename: 'e1.md', docType: 'epic' };
    const p2 = { key: 'EPIC-2', filename: 'e2.md', docType: 'epic' };
    const childToParent = new Map([
      ['C-1', p1],
      ['C-2', p2],
    ]);
    const selected = [
      { key: 'C-1', localExists: false },
      { key: 'C-2', localExists: true },
    ];
    const groups = groupSelectedChildrenByParent([p1, p2], selected, childToParent);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].childKeys, ['C-1']);
    assert.deepEqual(groups[0].overwriteKeys, []); // not localExists
    assert.deepEqual(groups[1].childKeys, ['C-2']);
    assert.deepEqual(groups[1].overwriteKeys, ['C-2']); // localExists -> pre-included
  });

  test('a parent with no selected children gets empty arrays, not omitted', () => {
    const p1 = { key: 'EPIC-1', filename: 'e1.md', docType: 'epic' };
    const groups = groupSelectedChildrenByParent([p1], [], new Map());
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].childKeys, []);
    assert.deepEqual(groups[0].overwriteKeys, []);
  });
});
