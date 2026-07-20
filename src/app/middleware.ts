// ── Express middleware setup ────────────────────────────────────────────────────
import express, { type Express } from 'express';
import path from 'path';
import { requestLogger } from '../utils/requestLogger.js';
import { apiLimiter, aiLimiter, jiraLimiter } from '../middleware/rateLimiter.js';

export function applyMiddleware(app: Express, rootDir: string): void {
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  app.use(requestLogger());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/', apiLimiter);
  app.use('/api/generate', aiLimiter);
  app.use('/api/doc/:type/:filename/upgrade', aiLimiter);
  app.use('/api/docs/split-story', aiLimiter);
  app.use('/api/split-epic', aiLimiter);
  app.use('/api/jira', jiraLimiter);

  app.use(
    '/public/js',
    express.static(path.join(rootDir, 'public/js'), {
      etag: true,
      lastModified: true,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      },
    })
  );
  app.use(
    '/public/css',
    express.static(path.join(rootDir, 'public/css'), {
      etag: true,
      lastModified: true,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      },
    })
  );

  app.get('/', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });
  app.get('/index.html', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  app.use(express.static(rootDir));

  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/v1/')) {
      req.url = '/api' + req.url.slice('/api/v1'.length);
    }
    next();
  });
}
