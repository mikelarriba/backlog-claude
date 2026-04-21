// ── Unit tests: src/services/storyService.js ─────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseStorySections, serializeStoryFile, extractStoryTitle } from '../../src/services/storyService.js';

const FIXTURE = `---
JIRA_ID: TBD
Status: Draft
---

## Story 1: Login flow

As a user I want to log in.

### Acceptance Criteria
- Given I am on the login page, when I submit valid credentials, then I am redirected.

## Story 2: Logout flow

As a user I want to log out.

### Acceptance Criteria
- Given I am logged in, when I click logout, then my session ends.
`;

// ── parseStorySections ────────────────────────────────────────────────────────
describe('parseStorySections', () => {
  test('returns two sections for the fixture', () => {
    const { sections } = parseStorySections(FIXTURE);
    assert.equal(sections.length, 2);
  });

  test('extracts frontmatter separately', () => {
    const { frontmatter } = parseStorySections(FIXTURE);
    assert.match(frontmatter, /^---/);
    assert.match(frontmatter, /Status: Draft/);
  });

  test('each section starts with ## Story', () => {
    const { sections } = parseStorySections(FIXTURE);
    for (const s of sections) {
      assert.match(s, /^## Story \d+/);
    }
  });

  test('sections contain correct body text', () => {
    const { sections } = parseStorySections(FIXTURE);
    assert.match(sections[0], /Login flow/);
    assert.match(sections[1], /Logout flow/);
  });

  test('returns one section for content with no story markers', () => {
    // split() on a string with no match returns the whole string as one element
    const { sections } = parseStorySections('---\nStatus: Draft\n---\n\nJust a note.\n');
    assert.equal(sections.length, 1);
  });
});

// ── extractStoryTitle ─────────────────────────────────────────────────────────
describe('extractStoryTitle', () => {
  test('extracts the ## heading as title', () => {
    const section = '## Story 1: Login flow\n\nBody text.';
    assert.equal(extractStoryTitle(section), 'Story 1: Login flow');
  });

  test('returns Untitled Story when no ## heading', () => {
    assert.equal(extractStoryTitle('No heading here'), 'Untitled Story');
  });
});

// ── serializeStoryFile ────────────────────────────────────────────────────────
describe('serializeStoryFile', () => {
  test('joins frontmatter and sections with newlines', () => {
    const fm = '---\nStatus: Draft\n---\n';
    const sections = ['## Story 1\n\nBody', '## Story 2\n\nBody'];
    const result = serializeStoryFile(fm, sections);
    assert.match(result, /---\nStatus: Draft/);
    assert.match(result, /## Story 1/);
    assert.match(result, /## Story 2/);
  });

  test('round-trips parse → serialize → parse unchanged', () => {
    const { frontmatter, sections } = parseStorySections(FIXTURE);
    const serialized = serializeStoryFile(frontmatter, sections);
    const { sections: sections2 } = parseStorySections(serialized);
    assert.equal(sections2.length, sections.length);
    assert.equal(sections2[0].trim(), sections[0].trim());
  });
});
