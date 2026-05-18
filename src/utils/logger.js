// ── Levelled logger ───────────────────────────────────────────────────────────
// Reads LOG_LEVEL at call time so tests can set process.env.LOG_LEVEL before
// importing and still change it mid-run. Levels: debug < info < warn < error.
//
// Usage:
//   import { createLogger } from './logger.js';
//   const { logInfo, logWarn, logError } = createLogger('[my-app]');

const LEVEL_MAP = { debug: 0, info: 1, warn: 2, error: 3 };

function currentLevel() {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVEL_MAP[raw] ?? LEVEL_MAP.info;
}

function fmt(prefix, level, scope, message) {
  return `${prefix} ${new Date().toISOString()} [${level}] [${scope}] ${message}`;
}

/**
 * Create a set of levelled log functions bound to an application prefix.
 * @param {string} prefix - e.g. '[backlog-claude]'
 * @returns {{ logDebug, logInfo, logWarn, logError }}
 */
export function createLogger(prefix) {
  return {
    logDebug: (scope, message, meta = {}) => {
      if (currentLevel() <= LEVEL_MAP.debug) console.debug(fmt(prefix, 'DEBUG', scope, message), meta);
    },
    logInfo: (scope, message, meta = {}) => {
      if (currentLevel() <= LEVEL_MAP.info) console.log(fmt(prefix, 'INFO', scope, message), meta);
    },
    logWarn: (scope, message, meta = {}) => {
      if (currentLevel() <= LEVEL_MAP.warn) console.warn(fmt(prefix, 'WARN', scope, message), meta);
    },
    logError: (scope, message, meta = {}) => {
      if (currentLevel() <= LEVEL_MAP.error) console.error(fmt(prefix, 'ERROR', scope, message), meta);
    },
  };
}
