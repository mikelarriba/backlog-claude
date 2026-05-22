// ── Integration tests: POST /api/split-epic ──────────────────────────────────
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

function writeDoc(subdir, filename, content) {
  const dir = path.join(docsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

// ── Validation ────────────────────────────────────────────────────────────────
describe('POST /api/split-epic — validation', () => {
  test('returns 400 when epicFilename is missing', async () => {
    const { status, data } = await api('POST', '/api/split-epic', { description: 'test' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 400 when description is missing', async () => {
    const { status, data } = await api('POST', '/api/split-epic', { epicFilename: 'test.md' });
    assert.equal(status, 400);
    assert.equal(data.error.code, 'VALIDATION_ERROR');
  });

  test('returns 404 when epic file does not exist', async () => {
    const { status } = await api('POST', '/api/split-epic', {
      epicFilename: 'nonexistent.md',
      description: 'test',
    });
    assert.equal(status, 404);
  });
});

// ── Epic without Feature (auto-creates Feature) ──────────────────────────────
describe('POST /api/split-epic — auto-creates Feature when none exists', () => {
  const EPIC_FILE = '2026-01-01-orphan-epic.md';

  before(() => {
    writeDoc('epics', EPIC_FILE, `---
JIRA_ID: TBD
Story_Points: 5
Status: Draft
Priority: High
Fix_Version: PI-2026.1
Created: 2026-01-01
---

## Orphan Epic Title

## Context
An epic with no feature parent.

## Objective
Test auto-feature creation.
`);
  });

  test('returns 200 with featureCreated=true and new epic filename', async () => {
    const { status, data } = await api('POST', '/api/split-epic', {
      epicFilename: EPIC_FILE,
      description: 'Extract the authentication scope',
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.featureCreated, true);
    assert.ok(data.featureFilename, 'featureFilename should be set');
    assert.ok(data.newEpicFilename, 'newEpicFilename should be set');
    assert.ok(data.featureTitle, 'featureTitle should be set');
  });

  test('original epic gets Feature_ID set', async () => {
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(EPIC_FILE)}`);
    assert.ok(doc.content, 'should have content');
    assert.match(doc.content, /^Feature_ID: .+\.md$/m);
  });

  test('feature file was created on disk', async () => {
    const { data: doc } = await api('GET', `/api/doc/epic/${encodeURIComponent(EPIC_FILE)}`);
    const featureIdMatch = doc.content.match(/^Feature_ID:\s*(.+)$/m);
    assert.ok(featureIdMatch, 'Feature_ID should exist in frontmatter');
    const featurePath = path.join(docsRoot, 'features', featureIdMatch[1].trim());
    assert.ok(fs.existsSync(featurePath), 'feature file should exist on disk');
  });
});

// ── Epic with existing Feature ───────────────────────────────────────────────
describe('POST /api/split-epic — uses existing Feature', () => {
  const FEATURE_FILE = '2026-01-01-existing-feature.md';
  const EPIC_FILE    = '2026-01-01-epic-with-feature.md';

  before(() => {
    writeDoc('features', FEATURE_FILE, `---
JIRA_ID: TBD
Status: Draft
Priority: High
Created: 2026-01-01
---

## Existing Feature
`);
    writeDoc('epics', EPIC_FILE, `---
JIRA_ID: TBD
Story_Points: 3
Status: Draft
Priority: Medium
Feature_ID: ${FEATURE_FILE}
Created: 2026-01-01
---

## Epic With Feature Parent

## Context
Already linked to a feature.
`);
  });

  test('returns 200 with featureCreated=false and same feature filename', async () => {
    const { status, data } = await api('POST', '/api/split-epic', {
      epicFilename: EPIC_FILE,
      description: 'Split off the reporting module',
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(data.featureCreated, false);
    assert.equal(data.featureFilename, FEATURE_FILE);
    assert.ok(data.newEpicFilename, 'newEpicFilename should be set');
  });

  test('new epic has Feature_ID pointing to existing feature', async () => {
    // Get the new epic filename from a fresh split
    const { data } = await api('POST', '/api/split-epic', {
      epicFilename: EPIC_FILE,
      description: 'Another split',
    });
    const { data: newDoc } = await api('GET', `/api/doc/epic/${encodeURIComponent(data.newEpicFilename)}`);
    assert.match(newDoc.content, new RegExp(`^Feature_ID: ${FEATURE_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });
});
