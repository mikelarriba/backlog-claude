// ── Structured JSON logger ─────────────────────────────────────────────────────
// Each log line is a valid JSON object: { ts, level, msg, prefix, scope, ...meta }.
// Reads LOG_LEVEL at call time so tests can change process.env.LOG_LEVEL mid-run.
// Levels: debug < info < warn < error.
//
// Usage:
//   import { createLogger } from './logger.js';
//   const { logInfo, logWarn, logError } = createLogger('[my-app]');

const LEVEL_MAP: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVEL_MAP[raw] ?? LEVEL_MAP.info;
}

function emit(
  level: string,
  consoleFn: (...args: unknown[]) => void,
  prefix: string,
  scope: string,
  msg: string,
  meta?: Record<string, unknown>
): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    prefix,
    scope,
    ...meta,
  };
  consoleFn(JSON.stringify(entry));
}

export interface Logger {
  logDebug: (scope: string, message: string, meta?: Record<string, unknown>) => void;
  logInfo: (scope: string, message: string, meta?: Record<string, unknown>) => void;
  logWarn: (scope: string, message: string, meta?: Record<string, unknown>) => void;
  logError: (scope: string, message: string, meta?: Record<string, unknown>) => void;
}

export function createLogger(prefix: string): Logger {
  return {
    logDebug: (scope, message, meta) => {
      if (currentLevel() <= LEVEL_MAP.debug)
        emit('debug', console.debug, prefix, scope, message, meta);
    },
    logInfo: (scope, message, meta) => {
      if (currentLevel() <= LEVEL_MAP.info) emit('info', console.log, prefix, scope, message, meta);
    },
    logWarn: (scope, message, meta) => {
      if (currentLevel() <= LEVEL_MAP.warn)
        emit('warn', console.warn, prefix, scope, message, meta);
    },
    logError: (scope, message, meta) => {
      if (currentLevel() <= LEVEL_MAP.error)
        emit('error', console.error, prefix, scope, message, meta);
    },
  };
}
