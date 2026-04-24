// ── Unit tests: src/services/claudeService.js ─────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  callClaude,
  streamClaude,
  setModelOverride,
  getModelOverride,
} from '../../src/services/claudeService.js';

// All tests run with MOCK_CLAUDE=1 to avoid spawning the real claude process.
before(() => { process.env.MOCK_CLAUDE = '1'; });
after(() => { delete process.env.MOCK_CLAUDE; });

describe('callClaude (mock mode)', () => {
  test('returns mock response content', async () => {
    const result = await callClaude('/tmp', 'test prompt');
    assert.ok(typeof result === 'string');
    assert.match(result, /Mock Epic Title/);
    assert.match(result, /Status: Draft/);
  });
});

describe('streamClaude (mock mode)', () => {
  test('calls onChunk with mock response', async () => {
    const chunks = [];
    await streamClaude('/tmp', 'test prompt', (chunk) => chunks.push(chunk));
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /Mock Epic Title/);
  });
});

describe('model override', () => {
  after(() => setModelOverride(null));

  test('defaults to null', () => {
    setModelOverride(null);
    assert.equal(getModelOverride(), null);
  });

  test('setModelOverride stores the model', () => {
    setModelOverride('claude-haiku-4-5');
    assert.equal(getModelOverride(), 'claude-haiku-4-5');
  });

  test('setModelOverride with empty string resets to null', () => {
    setModelOverride('claude-haiku-4-5');
    setModelOverride('');
    assert.equal(getModelOverride(), null);
  });
});
