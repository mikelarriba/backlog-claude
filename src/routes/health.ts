// ── Enhanced health check route ──────────────────────────────────────────────
import type { RequestHandler } from 'express';
import { fileExists } from '../utils/routeHelpers.js';
import type { AppContext } from '../app/context.js';

export function healthHandler(ctx: AppContext): RequestHandler {
  return async (_req, res) => {
    const docsExists = await fileExists(ctx.DOCS_ROOT);
    const jiraCircuitState = ctx.jiraCircuit.getState();
    const docIndexReady = ctx.shared.docIndex.isReady();

    const dependencies = {
      filesystem: docsExists ? 'ok' : 'error',
      jira: jiraCircuitState === 'OPEN' ? 'degraded' : 'ok',
      docIndex: docIndexReady ? 'ok' : 'starting',
    };

    const hasCriticalError = dependencies.filesystem === 'error';
    const status = hasCriticalError ? 'error' : 'ok';

    res.status(hasCriticalError ? 503 : 200).json({
      status,
      uptime: process.uptime(),
      docsDir: docsExists,
      version: process.env.npm_package_version ?? 'unknown',
      dependencies,
    });
  };
}
