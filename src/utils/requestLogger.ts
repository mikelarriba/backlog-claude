// ── HTTP request logging middleware ────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { createLogger } from './logger.js';

const { logInfo } = createLogger('[http]');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const correlationId = randomUUID();
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    const start = Date.now();
    res.on('finish', () => {
      logInfo('request', `${req.method} ${req.path} ${res.statusCode} (${Date.now() - start}ms)`, {
        correlationId,
      });
    });
    next();
  };
}
