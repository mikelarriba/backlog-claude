// ── Express middleware setup ────────────────────────────────────────────────────
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'path';
import { requestLogger } from '../utils/requestLogger.js';
import { config } from '../config/env.js';
import { apiLimiter, aiLimiter, jiraLimiter } from '../middleware/rateLimiter.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Strip the port from a Host header value, keeping IPv6 brackets. */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

function allowedHosts(): Set<string> {
  const extra = config.ALLOWED_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOOPBACK_HOSTS, ...extra]);
}

/**
 * Blocks DNS-rebinding (foreign Host header) and cross-site mutating requests
 * (Origin present but not matching the request host).
 */
export function hostOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const hostHeader = req.headers.host ?? '';
  if (!allowedHosts().has(hostnameOf(hostHeader))) {
    res.status(403).json({ error: 'Forbidden: host not allowed' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        // malformed Origin falls through to rejection
      }
      if (originHost !== hostHeader.trim().toLowerCase()) {
        res.status(403).json({ error: 'Forbidden: cross-origin request rejected' });
        return;
      }
    }
  }
  next();
}

/**
 * Returns index.html with the module entry rewritten to the hashed bundle from
 * public/dist/manifest.json, or null when no bundle has been built.
 */
export function renderIndexHtml(rootDir: string): string | null {
  let entry: string | undefined;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'public/dist/manifest.json'), 'utf-8')
    ) as Record<string, string>;
    entry = manifest['main.js'];
  } catch {
    return null;
  }
  if (!entry) return null;
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  return html.replace('/public/js/main.js', `/public/dist/${entry}`);
}

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

  app.use(hostOriginGuard);
  app.use(requestLogger());
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/', apiLimiter);
  app.use('/api/generate', aiLimiter);
  app.use('/api/doc/:type/:filename/upgrade', aiLimiter);
  app.use('/api/docs/split-story', aiLimiter);
  app.use('/api/split-epic', aiLimiter);
  app.use('/api/confluence/analyze', aiLimiter);
  app.use('/api/bugs/dashboard/analyze', aiLimiter);
  app.use('/api/bugs/create', aiLimiter);
  app.use('/api/epic/:filename/stories', aiLimiter);
  app.use('/api/skills/:name/improve', aiLimiter);
  app.use('/api/jira/comments/improve', aiLimiter);
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

  // Hashed bundle output (npm run build:bundle): filenames carry a content hash, so they
  // can be cached forever and a deploy never serves stale modules.
  app.use(
    '/public/dist',
    express.static(path.join(rootDir, 'public/dist'), {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );

  // index.html points at the hashed bundle when one has been built; otherwise it is
  // served untouched and loads the unbundled /public/js modules.
  const serveIndex = (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const html = renderIndexHtml(rootDir);
    if (html === null) return next();
    res.type('html').send(html);
  };
  app.get('/', serveIndex);
  app.get('/index.html', serveIndex);

  app.use(express.static(rootDir));

  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/v1/')) {
      req.url = '/api' + req.url.slice('/api/v1'.length);
    }
    next();
  });
}
