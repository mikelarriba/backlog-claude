// ── Unit tests: claudeService error paths ─────────────────────────────────────
// Covers: provider API errors, semaphore release on failure, and normalizeOutput
// edge cases. Uses MOCK_CLAUDE=0 with mocked fetch to exercise real error paths.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  callClaude,
  streamClaude,
  setProviderOverride,
  normalizeOutput,
} from '../../src/services/claudeService.js';

// ── GitHub Models provider — non-streaming error paths ────────────────────────

describe('callClaude — GitHub Models API errors', () => {
  const origFetch = global.fetch;

  before(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride('github-models');
    process.env.GITHUB_MODELS_TOKEN = 'fake-token-for-testing';
  });

  after(() => {
    global.fetch = origFetch;
    setProviderOverride(null);
    delete process.env.GITHUB_MODELS_TOKEN;
    process.env.MOCK_CLAUDE = '1';
  });

  test('rejects on HTTP 401 from GitHub Models', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await assert.rejects(
      () => callClaude('/tmp', 'test prompt', { maxAttempts: 1 }),
      (err) => {
        assert.ok(err instanceof Error, 'should throw Error');
        assert.ok(err.message.includes('401'), `expected 401 in message, got: ${err.message}`);
        return true;
      }
    );
  });

  test('rejects on HTTP 500 from GitHub Models', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await assert.rejects(
      () => callClaude('/tmp', 'test prompt', { maxAttempts: 1 }),
      /500/
    );
  });

  test('empty choices array returns empty string (not rejected)', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    const result = await callClaude('/tmp', 'test prompt', { maxAttempts: 1 });
    assert.equal(typeof result, 'string', 'should return a string even for empty response');
  });
});

// ── GitHub Models provider — streaming error paths ────────────────────────────

describe('streamClaude — GitHub Models API errors', () => {
  const origFetch = global.fetch;

  before(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride('github-models');
    process.env.GITHUB_MODELS_TOKEN = 'fake-token-for-testing';
  });

  after(() => {
    global.fetch = origFetch;
    setProviderOverride(null);
    delete process.env.GITHUB_MODELS_TOKEN;
    process.env.MOCK_CLAUDE = '1';
  });

  test('rejects on HTTP 401 from streaming endpoint', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await assert.rejects(
      () => streamClaude('/tmp', 'test prompt', () => {}),
      /401/
    );
  });

  test('rejects on HTTP 500 from streaming endpoint', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await assert.rejects(
      () => streamClaude('/tmp', 'test prompt', () => {}),
      /500/
    );
  });

  test('calls onChunk with streamed content on success', async () => {
    // Build a minimal SSE ReadableStream
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]',
    ].join('\n') + '\n';

    global.fetch = async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseLines));
          controller.close();
        },
      }),
    });

    const chunks = [];
    await streamClaude('/tmp', 'test prompt', (chunk) => chunks.push(chunk));
    assert.ok(chunks.length >= 1, 'should receive at least one chunk');
    assert.equal(chunks.join(''), 'Hello world');
  });
});

// ── Semaphore — releases on error ─────────────────────────────────────────────

describe('callClaude — semaphore releases on error', () => {
  const origFetch = global.fetch;

  before(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride('github-models');
    process.env.GITHUB_MODELS_TOKEN = 'fake-token-for-testing';
  });

  after(() => {
    global.fetch = origFetch;
    setProviderOverride(null);
    delete process.env.GITHUB_MODELS_TOKEN;
    process.env.MOCK_CLAUDE = '1';
  });

  test('semaphore is released after a failed call, allowing subsequent calls', async () => {
    // First call fails
    global.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await assert.rejects(
      () => callClaude('/tmp', 'failing prompt', { maxAttempts: 1 }),
      /503/
    );

    // Second call should succeed (semaphore must have been released)
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Hello' } }] }),
    });

    const result = await callClaude('/tmp', 'succeeding prompt', { maxAttempts: 1 });
    assert.ok(typeof result === 'string', 'second call should succeed after semaphore release');
  });
});

// ── normalizeOutput — edge cases ──────────────────────────────────────────────

describe('normalizeOutput — edge cases', () => {
  test('returns empty string for empty input', () => {
    assert.equal(normalizeOutput(''), '');
  });

  test('returns input unchanged when no code fence is present', () => {
    const input = '---\nStatus: Draft\n---\n\n## My Epic\n\nBody text.';
    assert.equal(normalizeOutput(input), input);
  });

  test('strips triple backtick markdown fence', () => {
    const input = '```markdown\n---\nStatus: Draft\n---\n\n## Title\n```';
    const result = normalizeOutput(input);
    assert.ok(!result.includes('```'), 'fences should be stripped');
    assert.ok(result.includes('---'), 'frontmatter should be preserved');
  });

  test('strips yaml-fenced frontmatter wrapper', () => {
    const input = '```yaml\n---\nStatus: Draft\n---\n```\n\n## Body';
    const result = normalizeOutput(input);
    assert.ok(!result.startsWith('```'), 'yaml fence should be stripped');
  });

  test('handles input that is only whitespace', () => {
    const result = normalizeOutput('   \n\t\n   ');
    assert.equal(typeof result, 'string');
  });

  test('preserves valid frontmatter without fences', () => {
    const input = '---\nTitle: My Epic\nStatus: Draft\n---\n\n## Body';
    const result = normalizeOutput(input);
    assert.ok(result.startsWith('---'), 'frontmatter should be at start');
    assert.ok(result.includes('Title: My Epic'), 'title should be preserved');
  });
});
