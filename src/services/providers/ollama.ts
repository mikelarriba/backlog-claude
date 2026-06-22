import { config } from '../../config/env.js';
import { callOpenAICompatible, streamOpenAICompatible } from './githubModels.js';
import type { AIProvider, ProviderCallOpts } from './types.js';

const CACHE_TTL_MS = 30_000;
let _healthCache: { result: boolean; expiresAt: number } | null = null;
let _modelsCache: { result: Array<{ id: string; name: string }>; expiresAt: number } | null = null;

export function _resetOllamaCache(): void {
  _healthCache = null;
  _modelsCache = null;
}

export async function checkOllamaHealth(): Promise<boolean> {
  const now = Date.now();
  if (_healthCache && now < _healthCache.expiresAt) return _healthCache.result;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await fetch(`${config.OLLAMA_BASE_URL}/`, { signal: controller.signal });
      _healthCache = { result: res.ok, expiresAt: now + CACHE_TTL_MS };
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    _healthCache = { result: false, expiresAt: now + CACHE_TTL_MS };
    return false;
  }
}

export async function fetchOllamaModels(): Promise<Array<{ id: string; name: string }>> {
  const now = Date.now();
  if (_modelsCache && now < _modelsCache.expiresAt) return _modelsCache.result;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    let res: Response;
    try {
      res = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      _modelsCache = { result: [], expiresAt: now + CACHE_TTL_MS };
      return [];
    }
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (json?.models || []).map((m: { name: string }) => ({
      id: m.name,
      name: m.name,
    }));
    _modelsCache = { result: models, expiresAt: now + CACHE_TTL_MS };
    return models;
  } catch {
    _modelsCache = { result: [], expiresAt: now + CACHE_TTL_MS };
    return [];
  }
}

export const ollamaProvider: AIProvider = {
  name: 'ollama',

  async call(prompt: string, { model, timeoutMs }: ProviderCallOpts): Promise<string> {
    const defaultModel = _modelsCache?.result?.[0]?.id || '';
    return callOpenAICompatible(
      `${config.OLLAMA_BASE_URL}/v1/chat/completions`,
      model || defaultModel,
      prompt,
      {},
      timeoutMs
    );
  },

  async stream(
    prompt: string,
    { model, timeoutMs }: ProviderCallOpts,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const defaultModel = _modelsCache?.result?.[0]?.id || '';
    return streamOpenAICompatible(
      `${config.OLLAMA_BASE_URL}/v1/chat/completions`,
      model || defaultModel,
      prompt,
      {},
      onChunk,
      timeoutMs
    );
  },
};
