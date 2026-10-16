import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChildEdges,
  parseCsvSet,
  selectRoadmapData,
} from '../../src/services/exportService.ts';

test('buildChildEdges keeps only in-set edges and dedupes parallel', () => {
  const kids = [
    { filename: 'a', blocks: ['b', 'x'], parallel: ['b'] },
    { filename: 'b', parallel: ['a'] },
  ];
  const { blocks, parallel } = buildChildEdges(kids);
  assert.deepEqual(blocks, [{ src: 'a', tgt: 'b' }]);
  assert.equal(parallel.length, 1);
});

test('parseCsvSet returns null for empty input', () => {
  assert.equal(parseCsvSet(''), null);
  assert.deepEqual([...parseCsvSet(' a, b ,')], ['a', 'b']);
});

test('selectRoadmapData filters by PI/sprint/team and orders epics by rank', () => {
  const docs = [
    { filename: 'e1', docType: 'epic', rank: 2 },
    { filename: 'e2', docType: 'epic', rank: 1 },
    {
      filename: 's1',
      docType: 'story',
      fixVersion: 'PI1',
      sprint: 'S1',
      team: 'T',
      parentFilename: 'e1',
      storyPoints: 3,
    },
    {
      filename: 's2',
      docType: 'story',
      fixVersion: 'PI2',
      sprint: 'S1',
      team: 'T',
      parentFilename: 'e1',
    },
    { filename: 's3', docType: 'bug', fixVersion: 'PI1', sprint: 'S2', team: 'U' },
  ];
  const r = selectRoadmapData({
    piParam: 'PI1',
    sprintsParam: '',
    teamsParam: 'T',
    sprintConfig: { PI1: [{ name: 'S1' }, { name: 'S2' }], PI2: [{ name: 'S3' }] },
    allDocs: docs,
    getDoc: (fn) => docs.find((d) => d.filename === fn),
  });
  assert.deepEqual(
    r.visibleLeafs.map((d) => d.filename),
    ['s1']
  );
  assert.deepEqual(
    r.sprints.map((s) => s.name),
    ['S1', 'S2']
  );
  assert.deepEqual(
    r.epicEntries.map(([k]) => k),
    ['e2', 'e1']
  );
  assert.equal(r.epicEntries[1][1].totalSP, 3);
});
