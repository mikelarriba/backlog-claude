// ── Unit tests: src/services/providers/ollama.ts ─────────────────────────────
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkOllamaHealth,
  fetchOllamaModels,
  _resetOllamaCache,
  ollamaProvider,
} from '../../src/services/providers/ollama.js';

describe('checkOllamaHealth', () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    _resetOllamaCache();
  });

  after(() => {
    global.fetch = origFetch;
    _resetOllamaCache();
  });

  test('returns true when Ollama responds with ok', async () => {
    global.fetch = async () => ({ ok: true });
    const result = await checkOllamaHealth();
    assert.equal(result, true);
  });

  test('returns false when Ollama responds with non-ok', async () => {
    global.fetch = async () => ({ ok: false });
    const result = await checkOllamaHealth();
    assert.equal(result, false);
  });

  test('returns false when fetch throws', async () => {
    global.fetch = async () => {
      throw new Error('connection refused');
    };
    const result = await checkOllamaHealth();
    assert.equal(result, false);
  });

  test('caches result for subsequent calls', async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      return { ok: true };
    };
    await checkOllamaHealth();
    await checkOllamaHealth();
    assert.equal(callCount, 1, 'second call should use cache');
  });
});

describe('fetchOllamaModels', () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    _resetOllamaCache();
  });

  after(() => {
    global.fetch = origFetch;
    _resetOllamaCache();
  });

  test('returns mapped models on success', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3:latest' }, { name: 'mistral:7b' }] }),
    });
    const models = await fetchOllamaModels();
    assert.equal(models.length, 2);
    assert.equal(models[0].id, 'llama3:latest');
    assert.equal(models[1].name, 'mistral:7b');
  });

  test('returns empty array when response is not ok', async () => {
    global.fetch = async () => ({ ok: false });
    const models = await fetchOllamaModels();
    assert.deepEqual(models, []);
  });

  test('returns empty array when fetch throws', async () => {
    global.fetch = async () => {
      throw new Error('network error');
    };
    const models = await fetchOllamaModels();
    assert.deepEqual(models, []);
  });
});

describe('_resetOllamaCache', () => {
  const origFetch = global.fetch;
  after(() => {
    global.fetch = origFetch;
  });

  test('forces a new fetch after reset', async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      return { ok: true };
    };
    await checkOllamaHealth();
    _resetOllamaCache();
    await checkOllamaHealth();
    assert.equal(callCount, 2, 'should re-fetch after cache reset');
  });
});

describe('ollamaProvider', () => {
  test('provider name is ollama', () => {
    assert.equal(ollamaProvider.name, 'ollama');
  });
});
