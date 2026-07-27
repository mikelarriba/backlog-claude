// ── Route registration ──────────────────────────────────────────────────────────
import path from 'path';
import express, { type Express, type ErrorRequestHandler } from 'express';
import { buildOpenApiSpec } from '../config/openapi.js';
import { sendError } from '../utils/routeHelpers.js';
import { ValidationError } from '../utils/validate.js';
import { TEAMS, WORK_CATEGORIES } from '../config/metadata.js';
import docsCrudRoutes from '../routes/docs-crud.js';
import docsAiRoutes from '../routes/docs-ai.js';
import docsBatchRoutes from '../routes/docs-batch.js';
import linksRoutes from '../routes/links.js';
import storiesRoutes from '../routes/stories.js';
import jiraPushDocRoutes from '../routes/jira-push-doc.js';
import jiraPushSprintsRoutes from '../routes/jira-push-sprints.js';
import jiraPushRankRoutes from '../routes/jira-push-rank.js';
import jiraSyncRoutes from '../routes/jira-sync.js';
import jiraSearchRoutes from '../routes/jira-search.js';
import confluenceRoutes from '../routes/confluence.js';
import settingsRoutes from '../routes/settings.js';
import bugRoutes from '../routes/bugs.js';
import canvasRoutes from '../routes/canvas.js';
import skillsRoutes from '../routes/skills.js';
import exportRoutes from '../routes/export.js';
import bugsDashboardRoutes from '../routes/bugs-dashboard.js';
import aiSavingsRoutes from '../routes/ai-savings.js';
import { healthHandler } from '../routes/health.js';
import type { AppContext } from './context.js';

export function registerRoutes(app: Express, ctx: AppContext, rootDir: string): void {
  const { shared, jiraShared, confluenceShared, handleEvents } = ctx;

  app.get('/api/events', handleEvents);

  app.get('/api/config/metadata', (_req, res) => {
    res.json({ teams: TEAMS, workCategories: WORK_CATEGORIES });
  });

  app.get('/api/health', healthHandler(ctx));

  const openApiSpec = buildOpenApiSpec();
  const swaggerUiPath = path.join(rootDir, 'node_modules', 'swagger-ui-dist');

  app.get('/api-docs/swagger-initializer.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(
      `window.onload = function() {
  window.ui = SwaggerUIBundle({
    url: '/api-docs/openapi.json',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true,
  });
};`
    );
  });

  app.get('/api-docs/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/api-docs', express.static(swaggerUiPath));

  app.use(docsCrudRoutes(shared));
  app.use(docsAiRoutes(shared));
  app.use(docsBatchRoutes(shared));
  app.use(linksRoutes(shared));
  app.use(storiesRoutes(shared));
  app.use(jiraPushDocRoutes(jiraShared));
  app.use(jiraPushSprintsRoutes(jiraShared));
  app.use(jiraPushRankRoutes(jiraShared));
  app.use(jiraSyncRoutes(jiraShared));
  app.use(jiraSearchRoutes(jiraShared));
  app.use(confluenceRoutes(confluenceShared));
  app.use(
    settingsRoutes({
      rootDir,
      broadcast: shared.broadcast,
      logInfo: shared.logInfo,
      jiraBase: jiraShared.JIRA_BASE,
    })
  );
  app.use(
    bugRoutes({
      BUGS_DIR: shared.BUGS_DIR,
      broadcast: shared.broadcast,
      callClaude: shared.callClaude,
      logInfo: shared.logInfo,
      logError: shared.logError,
      docIndex: shared.docIndex,
    })
  );
  app.use(canvasRoutes({ rootDir, logInfo: shared.logInfo }));
  app.use(
    skillsRoutes({
      rootDir,
      broadcast: shared.broadcast,
      callClaude: shared.callClaude,
      logInfo: shared.logInfo,
    })
  );
  app.use(exportRoutes({ rootDir, TYPE_CONFIG: shared.TYPE_CONFIG, docIndex: shared.docIndex }));
  app.use(bugsDashboardRoutes(jiraShared));
  app.use(aiSavingsRoutes({ rootDir, logInfo: shared.logInfo, logError: shared.logError }));

  const validationErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof ValidationError) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
      return;
    }
    next(err);
  };
  app.use(validationErrorHandler);

  // ── Catch-all error handler ──────────────────────────────────────────────────
  // Must be the last middleware registered. Normalises any unhandled synchronous
  // throw or rejected promise (forwarded via next(err)) into the standard
  // { error, code } JSON shape so callers never receive an HTML error page.
  const catchAllErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status =
      typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : typeof (err as { statusCode?: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Internal server error';
    sendError(res, status, 'INTERNAL_ERROR', message);
  };
  app.use(catchAllErrorHandler);
}
