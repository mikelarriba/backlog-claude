// ── Unit tests: resolveIssueKey() from src/routes/jira-comments.js ────────────
// Normalizes the Comments-view ticket filter: a bare number resolves against the
// configured project; a full key is uppercased and validated; anything else → ''.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIssueKey } from '../../src/routes/jira-comments.js';

describe('resolveIssueKey', () => {
  test('prefixes a bare number with the project key', () => {
    assert.equal(resolveIssueKey('9768', 'EAMDM'), 'EAMDM-9768');
  });

  test('accepts and uppercases a full issue key', () => {
    assert.equal(resolveIssueKey('eamdm-9768', 'EAMDM'), 'EAMDM-9768');
    assert.equal(resolveIssueKey('EAMDM-9768', 'EAMDM'), 'EAMDM-9768');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(resolveIssueKey('  9768  ', 'EAMDM'), 'EAMDM-9768');
  });

  test('returns empty string for blank or missing input', () => {
    assert.equal(resolveIssueKey('', 'EAMDM'), '');
    assert.equal(resolveIssueKey(undefined, 'EAMDM'), '');
    assert.equal(resolveIssueKey('   ', 'EAMDM'), '');
  });

  test('returns empty string for malformed keys', () => {
    assert.equal(resolveIssueKey('not a key', 'EAMDM'), '');
    assert.equal(resolveIssueKey('EAMDM-', 'EAMDM'), '');
    assert.equal(resolveIssueKey('-9768', 'EAMDM'), '');
  });

  test('cannot resolve a bare number without a project', () => {
    assert.equal(resolveIssueKey('9768', ''), '');
  });
});
