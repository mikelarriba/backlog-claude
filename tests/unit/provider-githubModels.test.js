// ── Unit tests: src/services/providers/githubModels.ts ────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  callOpenAICompatible,
  streamOpenAICompatible,
  githubModelsProvider,
} from '../../src/services/providers/githubModels.js';

const FAKE_ENDPOINT = 'https://test.example.com/completions';

describe('callOpenAICompatible', () => {
  const origFetch = global.fetch;
  after(() => {
    global.fetch = origFetch;
  });

  test('returns normalised content on success', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '```markdown\n# Title\n```' } }] }),
    });
    const result = await callOpenAICompatible(FAKE_ENDPOINT, 'model', 'prompt', {}, 5000);
    assert.equal(result, '# Title');
  });

  test('returns empty string for empty choices', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });
    const result = await callOpenAICompatible(FAKE_ENDPOINT, 'model', 'prompt', {}, 5000);
    assert.equal(result, '');
  });

  test('throws on HTTP 401', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    await assert.rejects(
      () => callOpenAICompatible(FAKE_ENDPOINT, 'model', 'prompt', {}, 5000),
      /401/
    );
  });

  test('throws on HTTP 500', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Error',
    });
    await assert.rejects(
      () => callOpenAICompatible(FAKE_ENDPOINT, 'model', 'prompt', {}, 5000),
      /500/
    );
  });
});

describe('streamOpenAICompatible', () => {
  const origFetch = global.fetch;
  after(() => {
    global.fetch = origFetch;
  });

  test('calls onChunk with streamed content', async () => {
    const sseLines =
      [
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
    await streamOpenAICompatible(FAKE_ENDPOINT, 'model', 'prompt', {}, (c) => chunks.push(c), 5000);
    assert.equal(chunks.join(''), 'Hello world');
  });

  test('throws on HTTP 401', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    await assert.rejects(
      () => streamOpenAICompatible(FAKE_ENDPOINT, 'model', 'prompt', {}, () => {}, 5000),
      /401/
    );
  });
});

describe('githubModelsProvider', () => {
  const origFetch = global.fetch;

  before(() => {
    process.env.GITHUB_MODELS_TOKEN = 'test-token';
  });

  after(() => {
    global.fetch = origFetch;
    delete process.env.GITHUB_MODELS_TOKEN;
  });

  test('provider name is github-models', () => {
    assert.equal(githubModelsProvider.name, 'github-models');
  });

  test('call throws when token is missing', async () => {
    delete process.env.GITHUB_MODELS_TOKEN;
    await assert.rejects(
      () => githubModelsProvider.call('prompt', { rootDir: '/tmp', model: '', timeoutMs: 5000 }),
      /GITHUB_MODELS_TOKEN/
    );
    process.env.GITHUB_MODELS_TOKEN = 'test-token';
  });

  test('call uses default model when model is empty', async () => {
    let capturedBody;
    global.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    };
    await githubModelsProvider.call('prompt', { rootDir: '/tmp', model: '', timeoutMs: 5000 });
    assert.equal(capturedBody.model, 'openai/gpt-4o');
  });
});
