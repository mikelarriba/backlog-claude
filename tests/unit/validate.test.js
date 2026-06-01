// ── Unit tests for src/utils/validate.ts ─────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  requireOneOf,
  requireString,
  requirePositiveInt,
  optionalString,
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

describe('requireOneOf', () => {
  test('accepts a value in the allowed list', () => {
    assert.equal(requireOneOf('High', VALID_PRIORITIES, 'priority'), 'High');
  });

  test('throws for a value not in the list', () => {
    assert.throws(() => requireOneOf('VeryHigh', VALID_PRIORITIES, 'priority'), ValidationError);
  });

  test('throws for a non-string value', () => {
    assert.throws(() => requireOneOf(42, VALID_PRIORITIES, 'priority'), ValidationError);
  });

  test('includes the field name in the error message', () => {
    try {
      requireOneOf('bad', ['a', 'b'], 'myField');
      assert.fail('expected throw');
    } catch (e) {
      assert.ok(e.message.includes('myField'));
    }
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

describe('requirePositiveInt', () => {
  test('accepts a valid positive integer', () => {
    assert.equal(requirePositiveInt(5, 'sp'), 5);
  });

  test('accepts string-encoded integer', () => {
    assert.equal(requirePositiveInt('3', 'sp'), 3);
  });

  test('throws for zero', () => {
    assert.throws(() => requirePositiveInt(0, 'sp'), ValidationError);
  });

  test('throws for negative', () => {
    assert.throws(() => requirePositiveInt(-1, 'sp'), ValidationError);
  });

  test('throws for float', () => {
    assert.throws(() => requirePositiveInt(1.5, 'sp'), ValidationError);
  });

  test('throws for non-number', () => {
    assert.throws(() => requirePositiveInt('abc', 'sp'), ValidationError);
  });

  test('throws when value exceeds max', () => {
    assert.throws(() => requirePositiveInt(50, 'sp', { max: 40 }), ValidationError);
  });

  test('accepts value equal to max', () => {
    assert.equal(requirePositiveInt(40, 'sp', { max: 40 }), 40);
  });
});

describe('optionalString', () => {
  test('returns undefined for undefined input', () => {
    assert.equal(optionalString(undefined, 'name'), undefined);
  });

  test('returns undefined for null input', () => {
    assert.equal(optionalString(null, 'name'), undefined);
  });

  test('returns the string for valid input', () => {
    assert.equal(optionalString('hello', 'name'), 'hello');
  });

  test('throws for empty string (still must be non-empty when provided)', () => {
    assert.throws(() => optionalString('', 'name'), ValidationError);
  });

  test('throws when length exceeds maxLength', () => {
    assert.throws(() => optionalString('too long string', 'name', { maxLength: 5 }), ValidationError);
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
    assert.deepEqual([...VALID_LINK_TYPES], ['blocks', 'parallel', 'epic→feature', 'story→epic', 'spike→epic', 'bug→epic']);
  });
});
