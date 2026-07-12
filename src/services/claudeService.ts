import { createLogger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { createProvider, getAvailableProviders } from './providers/index.js';

// Re-export provider utilities that callers depend on
export {
  normalizeOutput,
  loadProductContext,
  loadCommand,
  loadCommandRaw,
} from './providers/claudeCli.js';
export { _resetOllamaCache } from './providers/ollama.js';
export { getAvailableProviders };

const { logDebug, logInfo } = createLogger('[claudeService]');

// ── Concurrency semaphore ─────────────────────────────────────────────────────
class Semaphore {
  private readonly pending: Array<() => void> = [];
  private running = 0;

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    logDebug('semaphore', `AI call queued (queue depth: ${this.pending.length + 1})`);
    return new Promise((resolve) => this.pending.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.pending.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

const _concurrency = config.CLAUDE_CONCURRENCY;
const _semaphore = new Semaphore(
  Number.isFinite(_concurrency) && _concurrency > 0 ? _concurrency : 3
);

const CALL_TIMEOUT_MS = config.CLAUDE_TIMEOUT_MS;
const STREAM_TIMEOUT_MS = config.CLAUDE_STREAM_TIMEOUT_MS;

const MOCK_RESPONSE = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: Medium
Created: 2026-01-01T00:00:00.000Z
---

## Mock Epic Title

## Context
Mock context for testing.

## Objective
Mock objective.

## Value
Mock value.

## Execution
Mock execution steps.

## Acceptance Criteria
- Given a test environment, when tests run, then mocks are returned.

## Out of Scope
N/A
`;

const NO_RETRY_PATTERNS = [
  /invalid api key/i,
  /permission denied/i,
  /content policy/i,
  /context length/i,
];

let _modelOverride: string | null = null;
let _providerOverride: string | null = null;
let _effortOverride: string | null = null;

export function setModelOverride(model: string | null | undefined): void {
  _modelOverride = model || null;
}

export function getModelOverride(): string | null {
  return _modelOverride;
}

export function setProviderOverride(provider: string | null | undefined): void {
  _providerOverride = provider || null;
}

export function getProviderOverride(): string | null {
  return _providerOverride;
}

export function setEffortOverride(effort: string | null | undefined): void {
  _effortOverride = effort || null;
}

export function getEffortOverride(): string | null {
  return _effortOverride;
}

/**
 * Invoke the AI provider non-streaming. Dispatches to the active provider.
 * Retries up to `maxAttempts` times with exponential back-off (2s, 4s, 8s).
 * User-content errors are not retried.
 */
export async function callClaude(
  rootDir: string,
  prompt: string,
  { maxAttempts = 3 } = {}
): Promise<string> {
  if (process.env.MOCK_CLAUDE) return Promise.resolve(MOCK_RESPONSE);

  const t = Date.now();
  await _semaphore.acquire();
  try {
    const provider = createProvider(_providerOverride || 'claude-cli');
    const model = _modelOverride || '';
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await provider.call(prompt, {
          rootDir,
          model,
          timeoutMs: CALL_TIMEOUT_MS,
          effort: _effortOverride || undefined,
        });
        logInfo(
          'callClaude',
          `provider=${provider.name} model=${model || '(default)'} duration=${Date.now() - t}ms`
        );
        return result;
      } catch (err: unknown) {
        lastErr = err;
        const e = err as { isTimeout?: boolean; message?: string };
        const isUserError =
          !e.isTimeout && NO_RETRY_PATTERNS.some((p: RegExp) => p.test(e.message ?? ''));
        if (isUserError || attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
    throw lastErr;
  } finally {
    _semaphore.release();
  }
}

/**
 * Invoke the AI provider in streaming mode. Each chunk is forwarded to `onChunk`.
 */
export async function streamClaude(
  rootDir: string,
  prompt: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  if (process.env.MOCK_CLAUDE) {
    onChunk(MOCK_RESPONSE);
    return;
  }

  const t = Date.now();
  await _semaphore.acquire();
  try {
    const provider = createProvider(_providerOverride || 'claude-cli');
    const model = _modelOverride || '';
    await provider.stream(
      prompt,
      { rootDir, model, timeoutMs: STREAM_TIMEOUT_MS, effort: _effortOverride || undefined },
      onChunk
    );
    logInfo(
      'streamClaude',
      `provider=${provider.name} model=${model || '(default)'} duration=${Date.now() - t}ms`
    );
  } finally {
    _semaphore.release();
  }
}
