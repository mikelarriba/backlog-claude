// ── Levelled logger ───────────────────────────────────────────────────────────
// Reads LOG_LEVEL at call time so tests can set process.env.LOG_LEVEL before
// importing and still change it mid-run. Levels: debug < info < warn < error.
//
// Usage:
//   import { createLogger } from './logger.js';
//   const { logInfo, logWarn, logError } = createLogger('[my-app]');

const LEVEL_MAP: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVEL_MAP[raw] ?? LEVEL_MAP.info;
}

function fmt(prefix: string, level: string, scope: string, message: string): string {
  return `${prefix} ${new Date().toISOString()} [${level}] [${scope}] ${message}`;
}

export interface Logger {
  logDebug: (scope: string, message: string, meta?: Record<string, any>) => void;
  logInfo: (scope: string, message: string, meta?: Record<string, any>) => void;
  logWarn: (scope: string, message: string, meta?: Record<string, any>) => void;
  logError: (scope: string, message: string, meta?: Record<string, any>) => void;
}

/**
 * Create a set of levelled log functions bound to an application prefix.
 */
export function createLogger(prefix: string): Logger {
  return {
    logDebug: (scope: string, message: string, meta: Record<string, any> = {}) => {
      if (currentLevel() <= LEVEL_MAP.debug)
        console.debug(fmt(prefix, 'DEBUG', scope, message), meta);
    },
    logInfo: (scope: string, message: string, meta: Record<string, any> = {}) => {
      if (currentLevel() <= LEVEL_MAP.info) console.log(fmt(prefix, 'INFO', scope, message), meta);
    },
    logWarn: (scope: string, message: string, meta: Record<string, any> = {}) => {
      if (currentLevel() <= LEVEL_MAP.warn) console.warn(fmt(prefix, 'WARN', scope, message), meta);
    },
    logError: (scope: string, message: string, meta: Record<string, any> = {}) => {
      if (currentLevel() <= LEVEL_MAP.error)
        console.error(fmt(prefix, 'ERROR', scope, message), meta);
    },
  };
}
