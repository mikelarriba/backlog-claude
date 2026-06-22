// ── HTTP request logging middleware ────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { createLogger } from './logger.js';

const { logInfo } = createLogger('[http]');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      reqId: string;
    }
  }
}

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const reqId = randomUUID().slice(0, 8);
    req.reqId = reqId;
    res.setHeader('X-Request-Id', reqId);
    const start = Date.now();
    res.on('finish', () => {
      logInfo('request', `${req.method} ${req.path}`, {
        reqId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  };
}
