// ── Unit tests for src/utils/validate.ts ─────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  requireString,
  VALID_PRIORITIES,
  VALID_STATUSES,
  VALID_DOC_TYPES,
  VALID_LINK_TYPES,
} from '../../src/utils/validate.js';

describe('ValidationError', () => {
  test('has code VALIDATION_ERROR', () => {
    const e = new ValidationError('test');
    assert.equal(e.code, 'VALIDATION_ERROR');
    assert.equal(e.message, 'test');
    assert.ok(e instanceof Error);
  });
});

describe('requireString', () => {
  test('returns valid strings unchanged', () => {
    assert.equal(requireString('hello', 'name'), 'hello');
  });

  test('throws for empty string', () => {
    assert.throws(() => requireString('', 'name'), ValidationError);
  });

  test('throws for whitespace-only string', () => {
    assert.throws(() => requireString('   ', 'name'), ValidationError);
  });

  test('throws for non-string value', () => {
    assert.throws(() => requireString(null, 'name'), ValidationError);
  });

  test('throws when length exceeds maxLength', () => {
    assert.throws(() => requireString('hello world', 'name', { maxLength: 5 }), ValidationError);
  });

  test('accepts exactly maxLength characters', () => {
    assert.equal(requireString('hello', 'name', { maxLength: 5 }), 'hello');
  });

  test('throws when pattern does not match', () => {
    assert.throws(() => requireString('abc123', 'code', { pattern: /^\d+$/ }), ValidationError);
  });

  test('accepts matching pattern', () => {
    assert.equal(requireString('12345', 'code', { pattern: /^\d+$/ }), '12345');
  });
});

describe('enum constants', () => {
  test('VALID_PRIORITIES contains expected values', () => {
    assert.deepEqual([...VALID_PRIORITIES], ['Critical', 'High', 'Medium', 'Low']);
  });

  test('VALID_STATUSES contains expected values', () => {
    assert.deepEqual([...VALID_STATUSES], ['Draft', 'Created in JIRA', 'Archived']);
  });

  test('VALID_DOC_TYPES contains expected values', () => {
    assert.deepEqual([...VALID_DOC_TYPES], ['feature', 'epic', 'story', 'spike', 'bug']);
  });

  test('VALID_LINK_TYPES contains expected values', () => {
    assert.deepEqual(
      [...VALID_LINK_TYPES],
      ['blocks', 'parallel', 'epic→feature', 'story→epic', 'spike→epic', 'bug→epic']
    );
  });
});
