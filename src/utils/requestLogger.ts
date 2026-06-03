// ── HTTP request logging middleware ────────────────────────────────────────────
import type { RequestHandler } from 'express';
import { createLogger } from './logger.js';

const { logInfo } = createLogger('[http]');

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logInfo('request', `${req.method} ${req.path} ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  };
}
