// ── Unit tests: src/services/claudeService.js ─────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'node:fs';
import os   from 'node:os';
import path from 'node:path';
import {
  callClaude,
  streamClaude,
  setModelOverride,
  getModelOverride,
  setProviderOverride,
  getProviderOverride,
  getAvailableProviders,
  normalizeOutput,
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

// ── normalizeOutput ───────────────────────────────────────────────────────────
describe('normalizeOutput', () => {
  test('strips yaml-fenced frontmatter wrapper', () => {
    const input = '```yaml\n---\nStatus: Draft\n---\n```\n## Body';
    const result = normalizeOutput(input);
    assert.match(result, /^---/);
    assert.doesNotMatch(result, /^```/);
  });

  test('strips outer markdown code fence', () => {
    const input = '```markdown\n# Hello\n\nSome body\n```';
    const result = normalizeOutput(input);
    assert.match(result, /^# Hello/);
    assert.doesNotMatch(result, /```/);
  });

  test('returns plain content unchanged', () => {
    const plain = '---\nStatus: Draft\n---\n\n## Title\n\nBody text.';
    assert.equal(normalizeOutput(plain), plain.trim());
  });

  test('trims leading and trailing whitespace', () => {
    assert.equal(normalizeOutput('  hello  '), 'hello');
  });
});

// ── callClaude — error path ───────────────────────────────────────────────────
describe('callClaude — error path (real subprocess)', () => {
  let fakeBinDir;
  const origPath = process.env.PATH;

  before(() => {
    // Create a temp dir with a fake `claude` script that exits non-zero
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const scriptPath = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho "error: fake failure" >&2\nexit 1\n');
    fs.chmodSync(scriptPath, '0755');
    process.env.PATH = `${fakeBinDir}:${origPath}`;
    delete process.env.MOCK_CLAUDE;
  });

  after(() => {
    process.env.PATH = origPath;
    process.env.MOCK_CLAUDE = '1';
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  });

  test('throws when subprocess exits non-zero (maxAttempts=1, no back-off wait)', async () => {
    await assert.rejects(
      () => callClaude('/tmp', 'test', { maxAttempts: 1 }),
      (err) => {
        assert.match(err.message, /fake failure|claude exited 1/i);
        return true;
      },
    );
  });

  test('user-content errors are not retried (e.g. invalid api key)', async () => {
    // Replace the fake script with one that prints a no-retry error message
    const scriptPath = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho "Error: invalid api key" >&2\nexit 1\n');
    fs.chmodSync(scriptPath, '0755');

    let attempts = 0;
    // Wrap in a local spy — we can't directly count retries, so we count fast
    const start = Date.now();
    await assert.rejects(
      () => callClaude('/tmp', 'test', { maxAttempts: 3 }),
    );
    // With a user error, there should be NO back-off delay (< 500ms total even with 3 attempts)
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `Expected no back-off for user error, but took ${elapsed}ms`);
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

// ── provider override ─────────────────────────────────────────────────────────
describe('provider override', () => {
  after(() => setProviderOverride(null));

  test('defaults to null', () => {
    setProviderOverride(null);
    assert.equal(getProviderOverride(), null);
  });

  test('setProviderOverride stores the provider', () => {
    setProviderOverride('github-models');
    assert.equal(getProviderOverride(), 'github-models');
  });

  test('setProviderOverride with empty string resets to null', () => {
    setProviderOverride('github-models');
    setProviderOverride('');
    assert.equal(getProviderOverride(), null);
  });
});

// ── getAvailableProviders ─────────────────────────────────────────────────────
describe('getAvailableProviders', () => {
  const origToken = process.env.GITHUB_MODELS_TOKEN;

  after(() => {
    if (origToken === undefined) delete process.env.GITHUB_MODELS_TOKEN;
    else process.env.GITHUB_MODELS_TOKEN = origToken;
  });

  test('always includes claude-cli provider', () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    const providers = getAvailableProviders();
    assert.ok(providers.some(p => p.id === 'claude-cli'), 'claude-cli must be present');
  });

  test('does not include github-models when token is absent', () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    const providers = getAvailableProviders();
    assert.ok(!providers.some(p => p.id === 'github-models'), 'github-models must be absent without token');
  });

  test('includes github-models when GITHUB_MODELS_TOKEN is set', () => {
    process.env.GITHUB_MODELS_TOKEN = 'ghp_test_token';
    const providers = getAvailableProviders();
    assert.ok(providers.some(p => p.id === 'github-models'), 'github-models must appear when token is set');
    delete process.env.GITHUB_MODELS_TOKEN;
  });

  test('claude-cli provider has at least one model entry', () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    const providers = getAvailableProviders();
    const claudeProvider = providers.find(p => p.id === 'claude-cli');
    assert.ok(claudeProvider);
    assert.ok(Array.isArray(claudeProvider.models) && claudeProvider.models.length > 0);
  });

  test('github-models provider has expected models', () => {
    process.env.GITHUB_MODELS_TOKEN = 'ghp_test_token';
    const providers = getAvailableProviders();
    const ghProvider = providers.find(p => p.id === 'github-models');
    assert.ok(ghProvider);
    assert.ok(ghProvider.models.some(m => m.id === 'openai/gpt-4o'));
    delete process.env.GITHUB_MODELS_TOKEN;
  });
});

// ── callClaude — mock mode with provider override ─────────────────────────────
describe('callClaude — mock mode with provider override', () => {
  before(() => { process.env.MOCK_CLAUDE = '1'; });
  after(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride(null);
  });

  test('returns mock response when provider is github-models (MOCK_CLAUDE=1)', async () => {
    setProviderOverride('github-models');
    const result = await callClaude('/tmp', 'test prompt');
    assert.match(result, /Mock Epic Title/);
  });
});

// ── streamClaude — mock mode with provider override ──────────────────────────
describe('streamClaude — mock mode with provider override', () => {
  before(() => { process.env.MOCK_CLAUDE = '1'; });
  after(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride(null);
  });

  test('calls onChunk with mock response when provider is github-models (MOCK_CLAUDE=1)', async () => {
    setProviderOverride('github-models');
    const chunks = [];
    await streamClaude('/tmp', 'test prompt', chunk => chunks.push(chunk));
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /Mock Epic Title/);
  });
});
