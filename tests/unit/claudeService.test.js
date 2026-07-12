// ── Unit tests: src/services/claudeService.js ─────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  callClaude,
  streamClaude,
  loadCommand,
  loadCommandRaw,
  loadProductContext,
  setModelOverride,
  getModelOverride,
  setProviderOverride,
  getProviderOverride,
  setEffortOverride,
  getEffortOverride,
  getAvailableProviders,
  normalizeOutput,
  _resetOllamaCache,
} from '../../src/services/claudeService.js';

// All tests run with MOCK_CLAUDE=1 to avoid spawning the real claude process.
before(() => {
  process.env.MOCK_CLAUDE = '1';
});
after(() => {
  delete process.env.MOCK_CLAUDE;
});

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
      }
    );
  });

  test('user-content errors are not retried (e.g. invalid api key)', async () => {
    // Replace the fake script with one that prints a no-retry error message
    const scriptPath = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho "Error: invalid api key" >&2\nexit 1\n');
    fs.chmodSync(scriptPath, '0755');

    let _attempts = 0;
    // Wrap in a local spy — we can't directly count retries, so we count fast
    const start = Date.now();
    await assert.rejects(() => callClaude('/tmp', 'test', { maxAttempts: 3 }));
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

// ── effort override ───────────────────────────────────────────────────────────
describe('effort override', () => {
  after(() => setEffortOverride(null));

  test('defaults to null', () => {
    setEffortOverride(null);
    assert.equal(getEffortOverride(), null);
  });

  test('setEffortOverride stores the effort level', () => {
    setEffortOverride('high');
    assert.equal(getEffortOverride(), 'high');
  });

  test('setEffortOverride with empty string resets to null', () => {
    setEffortOverride('high');
    setEffortOverride('');
    assert.equal(getEffortOverride(), null);
  });
});

// ── getAvailableProviders ─────────────────────────────────────────────────────
describe('getAvailableProviders', () => {
  const origToken = process.env.GITHUB_MODELS_TOKEN;
  const origFetch = global.fetch;

  before(() => {
    // Stub fetch so Ollama health check fails instantly (no real server)
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (
        u.includes('localhost:11434') ||
        u.includes(process.env.OLLAMA_BASE_URL || 'localhost:11434')
      ) {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      }
      return origFetch(url, opts);
    };
  });

  after(() => {
    global.fetch = origFetch;
    _resetOllamaCache();
    if (origToken === undefined) delete process.env.GITHUB_MODELS_TOKEN;
    else process.env.GITHUB_MODELS_TOKEN = origToken;
  });

  test('always includes claude-cli provider', async () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    assert.ok(
      providers.some((p) => p.id === 'claude-cli'),
      'claude-cli must be present'
    );
  });

  test('does not include github-models when token is absent', async () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    assert.ok(
      !providers.some((p) => p.id === 'github-models'),
      'github-models must be absent without token'
    );
  });

  test('includes github-models when GITHUB_MODELS_TOKEN is set', async () => {
    process.env.GITHUB_MODELS_TOKEN = 'ghp_test_token';
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    assert.ok(
      providers.some((p) => p.id === 'github-models'),
      'github-models must appear when token is set'
    );
    delete process.env.GITHUB_MODELS_TOKEN;
  });

  test('claude-cli provider has at least one model entry', async () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    const claudeProvider = providers.find((p) => p.id === 'claude-cli');
    assert.ok(claudeProvider);
    assert.ok(Array.isArray(claudeProvider.models) && claudeProvider.models.length > 0);
  });

  test('claude-cli provider offers the current Claude model generation', async () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    const claudeProvider = providers.find((p) => p.id === 'claude-cli');
    const ids = claudeProvider.models.map((m) => m.id);
    assert.ok(ids.includes('claude-sonnet-5'), 'should offer Sonnet 5');
    assert.ok(ids.includes('claude-opus-4-8'), 'should offer Opus 4.8');
    assert.ok(ids.includes('claude-haiku-4-5-20251001'), 'should offer Haiku 4.5');
    assert.ok(
      !ids.includes('claude-sonnet-4-6') &&
        !ids.includes('claude-opus-4-6') &&
        !ids.includes('claude-haiku-4-5'),
      'stale 4.6-era model ids should be removed'
    );
  });

  test('claude-cli provider exposes reasoning-effort levels', async () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    const claudeProvider = providers.find((p) => p.id === 'claude-cli');
    assert.deepEqual(claudeProvider.effortLevels, ['low', 'medium', 'high', 'xhigh', 'max']);
  });

  test('non-claude-cli providers do not expose effortLevels', async () => {
    process.env.GITHUB_MODELS_TOKEN = 'ghp_test_token';
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    const ghProvider = providers.find((p) => p.id === 'github-models');
    assert.ok(ghProvider);
    assert.equal(ghProvider.effortLevels, undefined);
    delete process.env.GITHUB_MODELS_TOKEN;
  });

  test('github-models provider has expected models', async () => {
    process.env.GITHUB_MODELS_TOKEN = 'ghp_test_token';
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    const ghProvider = providers.find((p) => p.id === 'github-models');
    assert.ok(ghProvider);
    assert.ok(ghProvider.models.some((m) => m.id === 'openai/gpt-4o'));
    delete process.env.GITHUB_MODELS_TOKEN;
  });

  test('omits ollama when Ollama is not running', async () => {
    _resetOllamaCache();
    const providers = await getAvailableProviders();
    assert.ok(
      !providers.some((p) => p.id === 'ollama'),
      'ollama must be absent when health check fails'
    );
  });
});

// ── Ollama health check and model discovery ────────────────────────────────────
describe('Ollama provider (mocked fetch)', () => {
  const origFetch = global.fetch;
  const origOllamaUrl = process.env.OLLAMA_BASE_URL;

  before(() => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
  });

  after(() => {
    global.fetch = origFetch;
    _resetOllamaCache();
    if (origOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = origOllamaUrl;
  });

  test('includes ollama provider when health check passes and returns models', async () => {
    _resetOllamaCache();
    global.fetch = async (url) => {
      const u = String(url);
      if (u === 'http://localhost:11434/') return { ok: true, json: async () => ({}) };
      if (u === 'http://localhost:11434/api/tags') {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'llama3' }, { name: 'mistral' }] }),
        };
      }
      return origFetch(url);
    };
    const providers = await getAvailableProviders();
    const ollama = providers.find((p) => p.id === 'ollama');
    assert.ok(ollama, 'ollama provider must appear when health check passes');
    assert.equal(ollama.name, 'Ollama (local)');
    assert.ok(ollama.models.some((m) => m.id === 'llama3'));
    assert.ok(ollama.models.some((m) => m.id === 'mistral'));
  });

  test('omits ollama provider when health check returns non-ok', async () => {
    _resetOllamaCache();
    global.fetch = async (url) => {
      if (String(url) === 'http://localhost:11434/') return { ok: false };
      return origFetch(url);
    };
    const providers = await getAvailableProviders();
    assert.ok(
      !providers.some((p) => p.id === 'ollama'),
      'ollama must be absent when health check fails'
    );
  });

  test('caches health check result for TTL duration', async () => {
    _resetOllamaCache();
    let callCount = 0;
    global.fetch = async (url) => {
      const u = String(url);
      if (u === 'http://localhost:11434/') {
        callCount++;
        return { ok: true, json: async () => ({}) };
      }
      if (u === 'http://localhost:11434/api/tags')
        return { ok: true, json: async () => ({ models: [] }) };
      return origFetch(url);
    };
    await getAvailableProviders();
    await getAvailableProviders();
    assert.equal(callCount, 1, 'health check should be cached — fetch called only once');
  });

  test('caches model list for TTL duration', async () => {
    _resetOllamaCache();
    let modelCallCount = 0;
    global.fetch = async (url) => {
      const u = String(url);
      if (u === 'http://localhost:11434/') return { ok: true, json: async () => ({}) };
      if (u === 'http://localhost:11434/api/tags') {
        modelCallCount++;
        return { ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) };
      }
      return origFetch(url);
    };
    await getAvailableProviders();
    await getAvailableProviders();
    assert.equal(modelCallCount, 1, 'model list should be cached — /api/tags called only once');
  });
});

// ── callClaude — mock mode with provider override ─────────────────────────────
describe('callClaude — mock mode with provider override', () => {
  before(() => {
    process.env.MOCK_CLAUDE = '1';
  });
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
  before(() => {
    process.env.MOCK_CLAUDE = '1';
  });
  after(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride(null);
  });

  test('calls onChunk with mock response when provider is github-models (MOCK_CLAUDE=1)', async () => {
    setProviderOverride('github-models');
    const chunks = [];
    await streamClaude('/tmp', 'test prompt', (chunk) => chunks.push(chunk));
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /Mock Epic Title/);
  });
});

// ── callClaude — mock mode with Ollama provider override ──────────────────────
describe('callClaude — mock mode with Ollama provider override', () => {
  before(() => {
    process.env.MOCK_CLAUDE = '1';
  });
  after(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride(null);
  });

  test('returns mock response when provider is ollama (MOCK_CLAUDE=1)', async () => {
    setProviderOverride('ollama');
    const result = await callClaude('/tmp', 'test prompt');
    assert.match(result, /Mock Epic Title/);
  });
});

// ── streamClaude — mock mode with Ollama provider override ────────────────────
describe('streamClaude — mock mode with Ollama provider override', () => {
  before(() => {
    process.env.MOCK_CLAUDE = '1';
  });
  after(() => {
    delete process.env.MOCK_CLAUDE;
    setProviderOverride(null);
  });

  test('calls onChunk with mock response when provider is ollama (MOCK_CLAUDE=1)', async () => {
    setProviderOverride('ollama');
    const chunks = [];
    await streamClaude('/tmp', 'test prompt', (chunk) => chunks.push(chunk));
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /Mock Epic Title/);
  });
});

// ── loadCommand / loadCommandRaw — fallback logic ────────────────────────────
describe('loadCommand fallback', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-fallback-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when neither custom nor example exists', () => {
    assert.equal(loadCommand(tmpDir, 'nonexistent'), null);
  });

  test('falls back to example when custom does not exist', () => {
    const exDir = path.join(tmpDir, '.claude', 'commands.example');
    fs.mkdirSync(exDir, { recursive: true });
    fs.writeFileSync(
      path.join(exDir, 'test-cmd.md'),
      '---\nname: test-cmd\n---\nExample body $ARGUMENTS'
    );
    const result = loadCommand(tmpDir, 'test-cmd');
    assert.ok(result);
    assert.match(result, /Example body/);
    assert.doesNotMatch(result, /^---/); // frontmatter should be stripped
  });

  test('prefers custom over example', () => {
    const customDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(
      path.join(customDir, 'test-cmd.md'),
      '---\nname: test-cmd\n---\nCustom body $ARGUMENTS'
    );
    const result = loadCommand(tmpDir, 'test-cmd');
    assert.ok(result);
    assert.match(result, /Custom body/);
  });
});

describe('loadCommandRaw fallback', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-fallback-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null when neither custom nor example exists', () => {
    assert.equal(loadCommandRaw(tmpDir, 'nonexistent'), null);
  });

  test('falls back to example with source "example"', () => {
    const exDir = path.join(tmpDir, '.claude', 'commands.example');
    fs.mkdirSync(exDir, { recursive: true });
    fs.writeFileSync(path.join(exDir, 'raw-test.md'), '---\nname: raw-test\n---\nExample body');
    const result = loadCommandRaw(tmpDir, 'raw-test');
    assert.ok(result);
    assert.equal(result.source, 'example');
    assert.match(result.content, /^---/); // frontmatter should be included
    assert.match(result.content, /Example body/);
  });

  test('returns custom with source "custom" when it exists', () => {
    const customDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(path.join(customDir, 'raw-test.md'), '---\nname: raw-test\n---\nCustom body');
    const result = loadCommandRaw(tmpDir, 'raw-test');
    assert.ok(result);
    assert.equal(result.source, 'custom');
    assert.match(result.content, /Custom body/);
  });
});

describe('loadProductContext', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-ctx-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty content with source "example" when neither file exists', () => {
    const result = loadProductContext(tmpDir);
    assert.equal(result.content, '');
    assert.equal(result.source, 'example');
  });

  test('falls back to example file', () => {
    fs.writeFileSync(path.join(tmpDir, '.product-context.example.md'), '# Example Context');
    const result = loadProductContext(tmpDir);
    assert.equal(result.content, '# Example Context');
    assert.equal(result.source, 'example');
  });

  test('prefers custom over example', () => {
    fs.writeFileSync(path.join(tmpDir, '.product-context.md'), '# Custom Context');
    const result = loadProductContext(tmpDir);
    assert.equal(result.content, '# Custom Context');
    assert.equal(result.source, 'custom');
  });
});

describe('loadCommand with {{PRODUCT_CONTEXT}} injection', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-inject-'));
    const exDir = path.join(tmpDir, '.claude', 'commands.example');
    fs.mkdirSync(exDir, { recursive: true });
    fs.writeFileSync(
      path.join(exDir, 'test-inject.md'),
      '---\nname: test\n---\n## Context\n\n{{PRODUCT_CONTEXT}}\n\n$ARGUMENTS'
    );
    fs.writeFileSync(path.join(tmpDir, '.product-context.md'), 'My Product Details');
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('replaces {{PRODUCT_CONTEXT}} with product context content', () => {
    const result = loadCommand(tmpDir, 'test-inject');
    assert.ok(result);
    assert.ok(result.includes('My Product Details'));
    assert.ok(!result.includes('{{PRODUCT_CONTEXT}}'));
  });
});
