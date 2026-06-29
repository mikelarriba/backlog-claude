// ── Circuit breaker utility ─────────────────────────────────────────────────────
// Three-state circuit breaker: CLOSED → OPEN → HALF_OPEN → CLOSED
// When OPEN, calls fail immediately without hitting the underlying service.
// After resetTimeoutMs, one probe call is allowed (HALF_OPEN).
// A successful probe closes the circuit; a failing probe re-opens it.

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  readonly code = 'JIRA_CIRCUIT_OPEN';
  constructor() {
    super('JIRA circuit breaker is OPEN — service is temporarily unavailable');
    this.name = 'CircuitOpenError';
  }
}

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  getState(): CircuitState;
  getFailureCount(): number;
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  let state: CircuitState = 'CLOSED';
  let failureCount = 0;
  let lastFailureTime = 0;

  function recordSuccess(): void {
    state = 'CLOSED';
    failureCount = 0;
  }

  function recordFailure(): void {
    failureCount++;
    lastFailureTime = Date.now();
    if (failureCount >= options.failureThreshold) {
      state = 'OPEN';
    }
  }

  async function execute<T>(fn: () => Promise<T>): Promise<T> {
    if (state === 'OPEN') {
      if (Date.now() - lastFailureTime >= options.resetTimeoutMs) {
        state = 'HALF_OPEN';
      } else {
        throw new CircuitOpenError();
      }
    }

    try {
      const result = await fn();
      if (state === 'HALF_OPEN') recordSuccess();
      return result;
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      recordFailure();
      throw err;
    }
  }

  return {
    execute,
    getState: () => state,
    getFailureCount: () => failureCount,
  };
}
