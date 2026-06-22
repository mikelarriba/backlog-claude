import { normalizeOutput } from './claudeCli.js';
import type { AIProvider, ProviderCallOpts } from './types.js';

const ENDPOINT = 'https://models.github.ai/inference/chat/completions';

export async function callOpenAICompatible(
  endpoint: string,
  model: string,
  prompt: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API error ${res.status}: ${errText}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return normalizeOutput(json?.choices?.[0]?.message?.content ?? '');
}

export async function streamOpenAICompatible(
  endpoint: string,
  model: string,
  prompt: string,
  extraHeaders: Record<string, string>,
  onChunk: (chunk: string) => void,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
  if (!res.ok) {
    clearTimeout(timer);
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API error ${res.status}: ${errText}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);
        } catch {
          /* malformed SSE chunk — skip */
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export const githubModelsProvider: AIProvider = {
  name: 'github-models',

  async call(prompt: string, { model, timeoutMs }: ProviderCallOpts): Promise<string> {
    const token = process.env.GITHUB_MODELS_TOKEN;
    if (!token) throw new Error('GITHUB_MODELS_TOKEN is not set');
    return callOpenAICompatible(
      ENDPOINT,
      model || 'openai/gpt-4o',
      prompt,
      { Authorization: `Bearer ${token}` },
      timeoutMs
    );
  },

  async stream(
    prompt: string,
    { model, timeoutMs }: ProviderCallOpts,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const token = process.env.GITHUB_MODELS_TOKEN;
    if (!token) throw new Error('GITHUB_MODELS_TOKEN is not set');
    return streamOpenAICompatible(
      ENDPOINT,
      model || 'openai/gpt-4o',
      prompt,
      { Authorization: `Bearer ${token}` },
      onChunk,
      timeoutMs
    );
  },
};
